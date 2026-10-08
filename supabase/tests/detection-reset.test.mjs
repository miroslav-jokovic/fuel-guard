// FuelGuard — the detection reset (migration 0439; D-CF9, Q-CF1 (a); F02-F04 PLAN.md chunk 7a).
//
// WHY THIS FILE EXISTS. The reset runs once on production, closes every open fill alert, and nothing
// in the unit suites can execute it. A wrong WHERE clause there retires a case a person is working, or
// another org's queue, and there is no second run to correct it. So it is proven here, in PGlite,
// against the full migration ledger.
//
// What can be wrong, each asserted below:
//   • IT CLOSES THE WRONG CASES. Only OPEN cases on fills before the start date, in this org, are
//     retired; investigating, already-closed, superseded, later and other-org cases are left alone.
//   • IT CLOSES THEM WITHOUT A TRACE. Each retired case gets the disposition, who and when, a version
//     bump and one transition; the act gets one audit row naming the actor, the date and the counts.
//   • IT RUNS TWICE, OR WITHOUT AN ACTOR, OR FROM THE BROWSER. Each is refused.
//   • IT IS UNDONE BY THE NEXT DEPLOY. A retired fill re-scored by the boot rebuild opens a NEW case
//     (0158: only open/investigating cases block). Pinned here because it is why chunk 7b must make
//     scoring read the start date before chunk 7c runs this.
//
// Run:  node supabase/tests/detection-reset.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SUPA = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(SUPA, f), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations")).filter((f) => f.endsWith(".sql")).sort();

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
const count = async (q, p = []) => Number((await one(q, p)).n);
/** Run a statement and return its error message, or null when it succeeded. */
const err = async (p) => { try { await p; return null; } catch (e) { return e.message; } };

// Supabase-managed objects (present in a real project; shimmed here), as in rls.test.mjs.
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create schema if not exists storage;
  create table storage.buckets (
    id text primary key, name text, public boolean default false, file_size_limit bigint,
    allowed_mime_types text[], owner uuid,
    created_at timestamptz default now(), updated_at timestamptz default now()
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text, name text, owner uuid, owner_id text, created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text)
  returns text[] language sql immutable as $fn$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
  $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
  create role supabase_auth_admin nologin;
  create role authenticated nologin;
  create role anon nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public, storage to anon, authenticated, service_role;
`);

console.log(`Applying ${MIGRATIONS.length} migrations in lexical order`);
for (const name of MIGRATIONS) {
  await db.exec(read(`migrations/${name}`).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────────

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────────
const ORG = (await one(`insert into organizations (name) values ('Reset Co') returning id`)).id;
const OTHER = (await one(`insert into organizations (name) values ('Other Co') returning id`)).id;
const OWNER = (await one(`insert into auth.users (email) values ('owner@x.test') returning id`)).id;
const EPOCH = "2026-10-08T12:00:00Z";
const BEFORE = "2026-09-30T18:00:00Z";
const AFTER = "2026-10-08T13:00:00Z";

const fill = async (at = BEFORE, org = ORG) =>
  (await one(`insert into fuel_transactions (org_id, fueled_at, gallons) values ($1, $2, 100) returning id`, [org, at])).id;
const alert = async (txn, status, { at = BEFORE, org = ORG, disposition = null } = {}) =>
  (await one(
    `insert into anomalies (org_id, transaction_id, rule_id, severity, status, message, source, disposition, fueled_at)
     values ($1, $2, 'theft_case', 'critical', $3::anomaly_status, 'seeded', 'rules', $4, $5) returning id`,
    [org, txn, status, disposition, at],
  )).id;
const row = (id) => one(`select status::text, disposition, version, resolved_by, disposition_by, resolution_note from anomalies where id = $1`, [id]);
const reset = (org, actor, epoch) => db.query(`select * from reset_fill_detection($1, $2, $3)`, [org, actor, epoch]);

const open1 = await alert(await fill(), "open");
const open2 = await alert(await fill("2026-01-01T09:00:00Z"), "open", { at: "2026-01-01T09:00:00Z" });
const working = await alert(await fill(), "investigating");
const reviewed = await alert(await fill(), "dismissed", { disposition: "false_positive" });
const superseded = await alert(await fill(), "superseded");
const later = await alert(await fill(AFTER), "open", { at: AFTER });
const otherOrg = await alert(await fill(BEFORE, OTHER), "open", { org: OTHER });

console.log("\n-- refusals before anything changes --");
ok("no actor is refused", /actor is required/.test(await err(reset(ORG, null, EPOCH)) ?? ""));
ok("a start date in the future is refused", /not in the future/.test(await err(reset(ORG, OWNER, "2999-01-01T00:00:00Z")) ?? ""));
ok("…and neither left a trace",
  (await one(`select detection_epoch from organizations where id = $1`, [ORG])).detection_epoch === null &&
  (await count(`select count(*) n from audit_logs where action = 'anomalies.detection_reset'`)) === 0);

console.log("\n-- the act --");
// Caught, so a broken refusal above (a reset that already ran) reads as a FAIL here, never a crash.
const res = await reset(ORG, OWNER, EPOCH).then((r) => r.rows[0], (e) => ({ error: e.message }));
ok("it reports 2 retired and 1 kept because a person is investigating it", res.retired === 2 && res.kept_investigating === 1, JSON.stringify(res));
ok("the start date is set", new Date((await one(`select detection_epoch from organizations where id = $1`, [ORG])).detection_epoch).toISOString() === new Date(EPOCH).toISOString());
for (const [name, id] of [["the September alert", open1], ["the January alert", open2]]) {
  const r = await row(id);
  ok(`${name} is dismissed as retired, by the owner, one version on, with the note`,
    r.status === "dismissed" && r.disposition === "retired_reset_2026_10" && r.version === 2 &&
    r.resolved_by === OWNER && r.disposition_by === OWNER && /detection reset/.test(r.resolution_note ?? ""), JSON.stringify(r));
  const t = await one(`select from_status::text f, to_status::text t, from_version, to_version, disposition, actor_id from anomaly_transitions where anomaly_id = $1`, [id]);
  ok(`${name} has one transition open → dismissed, 1 → 2, by the owner`,
    t && t.f === "open" && t.t === "dismissed" && t.from_version === 1 && t.to_version === 2 &&
    t.disposition === "retired_reset_2026_10" && t.actor_id === OWNER, JSON.stringify(t));
}
ok("the investigated case is untouched", (await row(working)).status === "investigating" && (await row(working)).version === 1);
ok("the reviewed case keeps its reviewer's verdict", (await row(reviewed)).disposition === "false_positive" && (await row(reviewed)).version === 1);
ok("the superseded case is untouched", (await row(superseded)).status === "superseded" && (await row(superseded)).version === 1);
ok("a case on a fill after the start date stays open", (await row(later)).status === "open");
ok("another org's case stays open", (await row(otherOrg)).status === "open");
ok("another org's start date is not set", (await one(`select detection_epoch from organizations where id = $1`, [OTHER])).detection_epoch === null);
ok("only the two retired cases got a transition", (await count(`select count(*) n from anomaly_transitions`)) === 2);

const audit = (await db.query(`select * from audit_logs where action = 'anomalies.detection_reset'`)).rows;
ok("one audit row, naming the owner, the org, the start date and the counts",
  audit.length === 1 && audit[0].actor_id === OWNER && audit[0].org_id === ORG && audit[0].entity_id === ORG &&
  audit[0].meta.retired === 2 && audit[0].meta.kept_investigating === 1 &&
  new Date(audit[0].meta.epoch).toISOString() === new Date(EPOCH).toISOString() &&
  audit[0].meta.disposition === "retired_reset_2026_10", JSON.stringify(audit));

console.log("\n-- once per org --");
ok("a second reset is refused", /already reset/.test(await err(reset(ORG, OWNER, "2026-10-08T12:30:00Z")) ?? ""));
ok("…and changed nothing",
  (await count(`select count(*) n from audit_logs where action = 'anomalies.detection_reset'`)) === 1 &&
  (await row(later)).status === "open");

console.log("\n-- why 7b must come before 7c --");
{
  const txn = (await one(`select transaction_id from anomalies where id = $1`, [open1])).transaction_id;
  const attempt = (await one(
    `insert into scoring_attempts (id, org_id, transaction_id, engine_version, result_hash) values (gen_random_uuid(), $1, $2, 'v-matrix', 'h') returning id`,
    [ORG, txn],
  )).id;
  const kase = { rule_id: "theft_case", severity: "critical", message: "re-fired", evidence: {} };
  await db.query(
    `select public.persist_scoring_outcome_v2($1, $2, $3, null, now(), 'v-matrix', 'h', $4::jsonb, $5::jsonb, null, null, null, null)`,
    [attempt, ORG, txn, JSON.stringify(kase), JSON.stringify({ has_anomaly: true })],
  );
  ok("a retired fill re-scored with its rules still firing opens a NEW open case — scoring must read the start date",
    (await count(`select count(*) n from anomalies where transaction_id = $1 and status = 'open'`, [txn])) === 1);
  ok("…while the retired case itself stays retired", (await row(open1)).disposition === "retired_reset_2026_10");
}

console.log("\n-- the browser cannot reach it, and cannot move the start date --");
{
  const sig = "public.reset_fill_detection(uuid, uuid, timestamptz)";
  const g = await one(
    `select has_function_privilege('anon', $1, 'execute') a, has_function_privilege('authenticated', $1, 'execute') n,
            has_function_privilege('service_role', $1, 'execute') s`, [sig]);
  ok("reset_fill_detection: service role only", !g.a && !g.n && g.s, JSON.stringify(g));
  const pol = await count(
    `select count(*) n from pg_policies where schemaname = 'public' and tablename = 'organizations' and cmd in ('UPDATE', 'ALL')`);
  ok("organizations has no browser update policy, so detection_epoch moves only through the act", pol === 0, String(pol));
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
