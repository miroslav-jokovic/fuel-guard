// Silvicom 360 — filter-menu facets matrix (migrations 0313/0314, FUEL-P1 / D-FUI16).
//
// ── WHY THESE FUNCTIONS EXIST, AND WHAT THIS MATRIX HAS TO PROVE ────────────────────────────────
// The Fuel Log's three tabs offer nine filter menus, and until 0313/0314 every one of them was built
// by selecting rows into the browser and deduplicating there, under `.limit(10_000)`. That limit was
// never in force: the hosted PostgREST caps a response at 1,000 rows — measured against the live
// project on 2026-09-04, `select=id&limit=5000` returns exactly 1,000 — so nine menus over 28,638
// transaction lines and 3,479 declines were built from the first thousand of each. Production cost of
// that, measured the same day: 133 of 190 units, 133 of 249 drivers, 9 of 13 items, 42 of 47 states,
// 17 of 19 error codes. A value missing from a menu while its rows sit in the list is a filter that
// cannot be applied and a page that says nothing about why.
//
// So the property this matrix exists for is the one the plan's Done-when names: **the menu is never
// narrower than the data behind it**. It is asserted over 2,400 rows — past two 1,000-row page
// boundaries — with the distinguishing values placed deliberately in the LAST hundred, because a
// fixture whose rare values sit early passes whether the cap is respected or not.
//
// Three more properties that fail quietly:
//   1. ORG SCOPE, and it must hold with `p_org` OMITTED, because that is the call a browser makes
//      (D-FC1; three functions shipped unreachable on exactly this in 0258).
//   2. BLANK IS NOT A VALUE. EFS pads its fixed-width columns, so "", " " and null are three
//      spellings of "this line named nothing" and all three belong outside every menu — an empty
//      option in a dropdown is an unpressable button.
//   3. AN ERROR CODE CARRIES ITS DESCRIPTION. "51" means nothing in a menu; "51 — INVALID DRIVER ID"
//      means something. The label is deterministic (`min` over the non-empty descriptions) rather
//      than "whichever row arrived first", which is what it used to be.
//
// Run:  node supabase/tests/efs-facets.test.mjs
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
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Silvicom') returning id`)).id;
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Other') returning id`)).id;

// ── The fixture ─────────────────────────────────────────────────────────────────────────────────
// 2,400 EFS lines and 2,400 declines, both past two page boundaries. The first 2,300 rows of each
// repeat a small vocabulary; the values that only this matrix cares about are inserted at the END,
// which is the placement that makes the cap the thing under test. If they sat in the first thousand,
// a capped implementation would pass every assertion below.
const N = 2400;
const txn = [];
const dec = [];
for (let i = 0; i < N; i++) {
  const late = i >= N - 100;
  const unit = late ? `LATE-${i}` : `${700 + (i % 12)}`;
  const item = late ? "ULSR" : "ULSD";
  const driver = late ? `LATE DRIVER ${i}` : `DRIVER ${i % 9}`;
  const state = late ? "AK" : ["TX", "OK", "NM"][i % 3];
  txn.push(`(gen_random_uuid(), '${ORG}', '2026-08-${String(1 + (i % 28)).padStart(2, "0")}', '${unit}', '${item}', '${driver}', '${state}')`);
  const code = late ? `9${i % 10}` : `5${i % 4}`;
  const policy = late ? "LATE POLICY" : `POLICY ${i % 3}`;
  dec.push(`(gen_random_uuid(), '${ORG}', '2026-08-${String(1 + (i % 28)).padStart(2, "0")}T12:00:00Z', '${unit}', '${code}', 'REASON ${code}', '${driver}', '${state}', '${policy}')`);
}
for (let i = 0; i < N; i += 400) {
  await db.exec(
    `insert into efs_transactions (id, org_id, tran_date, unit, item, driver_name, state)
     values ${txn.slice(i, i + 400).join(",")}`,
  );
  await db.exec(
    `insert into declined_transactions (id, org_id, declined_at, unit, error_code, error_description, driver_name, state, policy_name)
     values ${dec.slice(i, i + 400).join(",")}`,
  );
}

const facets = async (fn, org = ORG) => all(`select * from ${fn}(p_org => $1)`, [org]);
const valuesOf = (rows, facet) => rows.filter((r) => r.facet === facet).map((r) => r.value).sort();

const t = await facets("efs_transaction_facets");
const d = await facets("decline_facets");

// ── 1. the menu is not narrower than the data ───────────────────────────────────────────────────
// 112 units: twelve repeated ones plus a hundred that appear only in the last hundred rows. The
// number is asserted rather than "more than 12" so a partial read cannot pass by being generous.
ok(
  `every one of the ${112} units appears, including the hundred that live past the 1,000-row cap`,
  valuesOf(t, "unit").length === 112,
  `${valuesOf(t, "unit").length}`,
);
ok(
  "the item a hundred late rows carry is offered — nine of thirteen items was the production symptom",
  valuesOf(t, "item").includes("ULSR") && valuesOf(t, "item").length === 2,
  valuesOf(t, "item").join(","),
);
ok("the state that only appears late is offered", valuesOf(t, "state").includes("AK"));
ok("the drivers are complete too — 9 repeated plus 100 late", valuesOf(t, "driver").length === 109, `${valuesOf(t, "driver").length}`);
ok("declines answer for their own units, not the fleet roster", valuesOf(d, "unit").length === 112, `${valuesOf(d, "unit").length}`);
ok("every error code appears, including the ten that only occur late", valuesOf(d, "error_code").length === 14, `${valuesOf(d, "error_code").length}`);
ok("the policy that only appears late is offered", valuesOf(d, "policy").includes("LATE POLICY"));

// ── 2. an error code carries its description, deterministically ─────────────────────────────────
const code51 = d.find((r) => r.facet === "error_code" && r.value === "51");
ok("an error code arrives with its description, which is the only thing that makes the menu readable",
  code51?.label === "REASON 51", `${code51?.label}`);
// Two descriptions for one code is the ordinary case in a vendor feed. `min` is not arbitrary — it is
// the same answer every time, where "the first row seen" depends on which thousand rows arrived.
await db.query(
  `insert into declined_transactions (org_id, declined_at, unit, error_code, error_description)
   values ($1,'2026-08-02T12:00:00Z','701','51','AAA EARLIER TEXT')`, [ORG]);
const relabelled = (await facets("decline_facets")).find((r) => r.facet === "error_code" && r.value === "51");
ok("two descriptions for one code resolve the same way every time, rather than by arrival order",
  relabelled?.label === "AAA EARLIER TEXT", `${relabelled?.label}`);
ok("a code is offered ONCE however many lines carry it",
  (await facets("decline_facets")).filter((r) => r.facet === "error_code" && r.value === "51").length === 1);

// ── 3. blank is not a value ─────────────────────────────────────────────────────────────────────
// EFS pads fixed-width columns, so a line that named no unit arrives as spaces rather than as null.
// An empty entry in a dropdown is an option nobody can act on, and it looks like a data error.
await db.exec(
  `insert into efs_transactions (org_id, tran_date, unit, item, driver_name, state)
   values ('${ORG}','2026-08-05','   ','','  ',null)`,
);
const withBlanks = await facets("efs_transaction_facets");
ok(
  "a padded-blank unit, item, driver and state are all absent from their menus — three spellings of 'named nothing'",
  valuesOf(withBlanks, "unit").length === 112 && valuesOf(withBlanks, "item").length === 2 &&
    valuesOf(withBlanks, "driver").length === 109 && valuesOf(withBlanks, "state").length === 4,
  `${valuesOf(withBlanks, "unit").length}/${valuesOf(withBlanks, "item").length}/${valuesOf(withBlanks, "driver").length}/${valuesOf(withBlanks, "state").length}`,
);
ok(
  "and no menu carries an empty string it could render as a blank row",
  !withBlanks.some((r) => r.value === null || r.value.trim() === ""),
);

// ── 4. org scope, on the call a browser actually makes ──────────────────────────────────────────
await db.exec(
  `insert into efs_transactions (org_id, tran_date, unit, item, driver_name, state)
   values ('${OTHER}','2026-08-05','OTHER-UNIT','OTHER-ITEM','OTHER DRIVER','ZZ')`,
);
await db.exec(
  `insert into declined_transactions (org_id, declined_at, unit, error_code, error_description, policy_name)
   values ('${OTHER}','2026-08-05T12:00:00Z','OTHER-UNIT','99','OTHER REASON','OTHER POLICY')`,
);
const stillMine = await facets("efs_transaction_facets");
ok("another carrier's units never enter this menu",
  !stillMine.some((r) => r.value.startsWith("OTHER")), "");
ok("nor their declines' policies",
  !(await facets("decline_facets")).some((r) => r.value.startsWith("OTHER")), "");

const USER = (await one(`insert into auth.users (email) values ('ops@silvicom.test') returning id`)).id;
await db.exec("begin");
await db.exec("set local role authenticated");
await db.query("select set_config('request.jwt.claims', $1, true)", [
  JSON.stringify({ sub: USER, org_id: ORG, user_role: "admin", role: "authenticated" }),
]);
// ⚠ p_org OMITTED — the form PostgREST resolves for a browser. A function that only works when the
// argument is supplied positionally is dead on arrival for the client and green in every test (0258).
const asBrowserT = (await db.query(`select * from efs_transaction_facets()`)).rows;
const asBrowserD = (await db.query(`select * from decline_facets()`)).rows;
await db.exec("rollback");
ok("a signed-in user gets their own org's menus with p_org omitted, which is the only call the browser can make",
  valuesOf(asBrowserT, "unit").length === 112 && !asBrowserT.some((r) => r.value.startsWith("OTHER")),
  `${valuesOf(asBrowserT, "unit").length}`);
ok("...and the same for the declines' menus",
  valuesOf(asBrowserD, "error_code").length === 14 && !asBrowserD.some((r) => r.value.startsWith("OTHER")),
  `${valuesOf(asBrowserD, "error_code").length}`);

// Release the WASM database before the verdict. This matrix exits explicitly only when it FAILS, so
// on the green path Node had to drain PGlite's handles on its own — ~10 seconds of idle wait after
// the last assertion, paid once per matrix per run. Measured 2026-09-05: 11.33s -> 1.32s here.
await db.close();

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
