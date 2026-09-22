// Silvicom 360 — the EFS processing run attempt ceiling (migration 0354).
//
// Before 0354 `efs_processing_runs.attempts` was incremented by every claim and read by nothing, so
// a run that could not complete was offered again forever. Measured on production 2026-09-22: three
// runs at 233–235 attempts since 2026-08-28, never completed, costing 47,522 scoring attempts and as
// many live Samsara reconciliations a day — 48.9% of all scoring in the product.
//
// The two properties worth pinning are opposite failure modes, and a test that only checks one of
// them is worse than none:
//
//   * the ceiling FIRES, so a permanent loop ends;
//   * the ceiling does NOT fire early, because among 7,566 succeeded runs the worst needed 66
//     attempts. A ceiling that abandoned those would destroy work silently.
//
// The third property is the one the production failure actually walks through: these runs advance
// via the STRANDED-RECLAIM branch, not via the retry ladder, because their process dies mid-pass and
// no TypeScript handler ever runs. A ceiling that only applied to `pending`/`failed` would be a
// ceiling the real failure mode steps around.
//
// Run: node supabase/tests/efs-run-attempt-ceiling.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations")).filter((f) => f.endsWith(".sql")).sort();

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
const all = async (q, p = []) => (await db.query(q, p)).rows;
const sqlstate = async (q, p = []) => {
  try { await db.query(q, p); return null; } catch (e) { return e.code ?? String(e.message); }
};

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
    bucket_id text, name text, owner uuid, created_at timestamptz default now()
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
`);
// Supabase's real default privileges, installed BEFORE the migrations — full DML granted, RLS is the
// gate. Without this a client "cannot insert" for the wrong reason and the test proves nothing.
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Ceiling Co') returning id`)).id;

/** One real import to hang every run off — `efs_processing_runs.import_id` is a FK to `imports`. */
const mkImport = async () =>
  (await one(
    `insert into imports (org_id, source, kind, filename) values ($1, 'efs_feed', 'transaction', 'ceiling.csv') returning id`,
    [ORG],
  )).id;

/**
 * A run in whatever state the case under test needs. `import_id` is deliberately a bare uuid rather
 * than a real import: the claim function never dereferences it, and inventing an import here would
 * couple this matrix to a table it is not testing.
 */
const mkRun = async ({ status, attempts, stale = false, lastError = null }) =>
  (await one(
    `insert into efs_processing_runs (org_id, import_id, feed, status, attempts, next_attempt_at, last_error, updated_at)
     values ($1, $6, 'posted', $2, $3, now() - interval '1 minute', $4,
             case when $5 then now() - interval '40 minutes' else now() end)
     returning id`,
    [ORG, status, attempts, lastError, stale, await mkImport()],
  )).id;

const claim = async (id) => await all(`select id, status, attempts from public.claim_efs_processing_run($1)`, [id]);
const row = async (id) => await one(`select status, attempts, last_error from efs_processing_runs where id = $1`, [id]);

// ── the constraint admits the new terminal value, and still admits nothing else ──────────────────
ok(
  "'abandoned' is a legal status",
  (await sqlstate(
    `insert into efs_processing_runs (org_id, import_id, feed, status) values ($1, $2, 'posted', 'abandoned')`,
    [ORG, await mkImport()],
  )) === null,
);
ok(
  "the status vocabulary is still closed — 'giving_up' is rejected",
  (await sqlstate(
    `insert into efs_processing_runs (org_id, import_id, feed, status) values ($1, $2, 'posted', 'giving_up')`,
    [ORG, await mkImport()],
  )) === "23514",
);

// ── the ceiling does NOT fire early: the worst SUCCEEDED run on production needed 66 attempts ────
for (const attempts of [0, 66, 98, 99]) {
  const id = await mkRun({ status: "pending", attempts });
  const claimed = await claim(id);
  const after = await row(id);
  ok(
    `a run at ${attempts} attempts is still claimed (production's worst success took 66)`,
    claimed.length === 1 && after.status === "running" && Number(after.attempts) === attempts + 1,
    `claimed=${claimed.length} status=${after?.status} attempts=${after?.attempts}`,
  );
}

// ── the ceiling fires, and the run stops being claimable ─────────────────────────────────────────
{
  const id = await mkRun({ status: "pending", attempts: 100 });
  const claimed = await claim(id);
  const after = await row(id);
  ok(
    "a run at 100 attempts is abandoned instead of claimed",
    claimed.length === 0 && after.status === "abandoned",
    `claimed=${claimed.length} status=${after?.status}`,
  );
  ok(
    "abandoning does not spend another attempt",
    Number(after.attempts) === 100,
    `attempts=${after?.attempts}`,
  );
  ok(
    "the abandoned run says why, naming its attempt count",
    typeof after.last_error === "string" && after.last_error.includes("100") && after.last_error.includes("ceiling"),
    `last_error=${after?.last_error}`,
  );

  // The loop must not resume on the next scheduler tick 30 seconds later.
  const again = await claim(id);
  const stillAfter = await row(id);
  ok(
    "an abandoned run is never claimed again",
    again.length === 0 && stillAfter.status === "abandoned" && Number(stillAfter.attempts) === 100,
    `claimed=${again.length} status=${stillAfter?.status} attempts=${stillAfter?.attempts}`,
  );
}

// ── the production failure mode: stranded in `running`, which is how all three reached 235 ───────
{
  const id = await mkRun({ status: "running", attempts: 235, stale: true });
  const claimed = await claim(id);
  const after = await row(id);
  ok(
    "a run stranded in `running` past the ceiling is abandoned, not reclaimed",
    claimed.length === 0 && after.status === "abandoned",
    `claimed=${claimed.length} status=${after?.status}`,
  );
}
{
  // Same branch, below the ceiling: reclaiming a genuinely stranded run must still work, or 0317's
  // whole purpose is undone by this migration.
  const id = await mkRun({ status: "running", attempts: 4, stale: true });
  const claimed = await claim(id);
  const after = await row(id);
  ok(
    "a stranded run below the ceiling is still reclaimed (0317 keeps working)",
    claimed.length === 1 && after.status === "running" && Number(after.attempts) === 5,
    `claimed=${claimed.length} status=${after?.status} attempts=${after?.attempts}`,
  );
}

// ── a real diagnosis outranks the sentence this migration writes ─────────────────────────────────
{
  const id = await mkRun({ status: "failed", attempts: 140, lastError: "EFS SOAP 500: statement unavailable" });
  await claim(id);
  const after = await row(id);
  ok(
    "an existing last_error survives abandonment — the diagnosis is worth more than the sentence",
    after.last_error === "EFS SOAP 500: statement unavailable",
    `last_error=${after?.last_error}`,
  );
}

// ── a run that is not due is untouched: the ceiling must not abandon rows the claim would refuse ──
{
  const id = (await one(
    `insert into efs_processing_runs (org_id, import_id, feed, status, attempts, next_attempt_at)
     values ($1, $2, 'posted', 'failed', 150, now() + interval '1 hour') returning id`,
    [ORG, await mkImport()],
  )).id;
  const claimed = await claim(id);
  const after = await row(id);
  ok(
    "a run past the ceiling but NOT yet due keeps its backoff and is left alone",
    claimed.length === 0 && after.status === "failed",
    `claimed=${claimed.length} status=${after?.status}`,
  );
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
