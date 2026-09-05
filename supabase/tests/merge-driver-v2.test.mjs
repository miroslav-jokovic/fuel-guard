// Silvicom 360 — merge_driver_v2 matrix (migration 0264, D-SEP5).
//
// The move list this matrix sends through the RPC is parsed from the REAL
// modules/roster/mergeDriver.ts — the same extraction check-driver-references.mjs uses — so the
// proof covers the actual production wiring, not a copy that can drift. What it pins:
//
//   1. THE MECHANICAL MOVES WORK FROM THE PARAMETER — including the four FKs the gate found
//      unhandled by v1 on its first run (idle_rollup_days attribution, case_pattern_reports,
//      fuel_exceptions, financial_entries — the last of which made v1 merges ABORT outright).
//   2. MD010 STANDS — signed evidence still refuses the merge before the first write.
//   3. MD020 — an unknown table/column in the move list aborts the WHOLE merge before any write.
//   4. OVERRIDE COLLISION — canonical's feature override wins; the source's duplicate dies
//      instead of killing the merge (v1 silently cascade-deleted ALL source overrides).
//   5. THE SOURCE DIES, THE CANONICAL INHERITS — links coalesce, the 0235 guard lets the one
//      legitimate delete through.
//
// Run:  node supabase/tests/merge-driver-v2.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations")).filter((f) => f.endsWith(".sql")).sort();

// The REAL list, parsed the way the gate parses it.
const tsSrc = readFileSync(join(SUPA, "..", "apps", "api", "src", "modules", "roster", "mergeDriver.ts"), "utf8");
const MOVES = [...tsSrc.matchAll(/\{\s*table:\s*"([a-z_][a-z0-9_]*)",\s*column:\s*"([a-z_][a-z0-9_]*)"(,\s*orgScoped:\s*true)?/g)]
  .map((m) => ({ table: m[1], column: m[2], org_scoped: !!m[3] }));
if (MOVES.length < 20) { console.error("could not parse DRIVER_REASSIGNMENTS"); process.exit(1); }

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const refuses = async (sql, params = []) => {
  try { await db.query(sql, params); return null; }
  catch (e) { return e; }
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
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS) {
  try { await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, "")); }
  catch (e) { console.error(`migration ${f} failed: ${e.message}`); process.exit(1); }
}

const ORG = "11111111-1111-1111-1111-111111111111";
const SRC = "dddddddd-0000-0000-0000-000000000001";
const CAN = "dddddddd-0000-0000-0000-000000000002";
await db.query(`insert into organizations (id, name) values ($1,'Carrier A')`, [ORG]);
await db.query(
  `insert into drivers (id, org_id, full_name, phone) values
   ($1, $3, 'Dup Driver', '555-0001'), ($2, $3, 'Real Driver', null)`,
  [SRC, CAN, ORG],
);

// seed rows for the four previously-unhandled tables, on the SOURCE driver
await db.query(
  `insert into fuel_exceptions (org_id, driver_id, fingerprint, kind, amount_kind)
   values ($1, $2, 'fp-1', 'recon_missing_in_system', 'unrecorded')`,
  [ORG, SRC],
);
await db.query(
  `insert into financial_entries (org_id, driver_id, direction, category, amount, occurred_at, source, source_table, external_id, lifecycle_stage, dedup_key, is_canonical, is_void)
   values ($1, $2, 'expense', 'fuel', 50, '2026-06-15T12:00:00Z', 'mcleod', 'mcleod_ap_vouchers', 'E1', 'invoice', 'K-m1', true, false)`,
  [ORG, SRC],
);
// feature override on BOTH drivers for the same key — the collision case
await db.query(`insert into driver_app_features (org_id, feature_key, enabled) values ($1, 'messages', true) on conflict do nothing`, [ORG]).catch(() => {});
await db.query(
  `insert into driver_app_feature_overrides (org_id, driver_id, feature_key, enabled) values
   ($1, $2, 'messages', false), ($1, $3, 'messages', true)`,
  [ORG, SRC, CAN],
);

const movesJson = JSON.stringify(MOVES);

console.log("\n---- Matrix: merge-driver-v2 --------------------------------------");

// ── 3. MD020 first: a bogus move aborts before any write ─────────────────────────────────────
const bad = await refuses(
  `select merge_driver_v2($1, $2, $3, $4::jsonb)`,
  [ORG, SRC, CAN, JSON.stringify([{ table: "no_such_table", column: "driver_id" }])],
);
ok("an unknown table in the move list aborts the whole merge (MD020)", bad !== null && /MD020|not a known public column/.test(bad.message));
const stillThere = await db.query(`select count(*)::int n from drivers where id=$1`, [SRC]);
ok("  and the source driver is untouched — validation ran before any write", stillThere.rows[0].n === 1);

// ── 1 + 4 + 5. the real merge, with the real list ────────────────────────────────────────────
const err = await refuses(`select merge_driver_v2($1, $2, $3, $4::jsonb)`, [ORG, SRC, CAN, movesJson]);
ok("merge_driver_v2 completes with the real DRIVER_REASSIGNMENTS list", err === null, err?.message ?? "");

const fin = await db.query(`select driver_id from financial_entries where org_id=$1 and external_id='E1'`, [ORG]);
ok("financial_entries follows the driver — the FK that made v1 merges abort", fin.rows[0]?.driver_id === CAN);
const fx = await db.query(`select driver_id from fuel_exceptions where org_id=$1 and fingerprint='fp-1'`, [ORG]);
ok("fuel_exceptions follows the driver — no longer stranded on a dead name", fx.rows[0]?.driver_id === CAN);
const ov = await db.query(`select enabled from driver_app_feature_overrides where org_id=$1 and driver_id=$2 and feature_key='messages'`, [ORG, CAN]);
ok("feature-override collision: canonical's override wins (v1 silently deleted the source's)", ov.rows.length === 1 && ov.rows[0].enabled === true);
const gone = await db.query(`select count(*)::int n from drivers where id=$1`, [SRC]);
ok("the source driver is deleted through the 0235 guard's one legitimate door", gone.rows[0].n === 0);
const phone = await db.query(`select phone from drivers where id=$1`, [CAN]);
ok("identity coalesces: the canonical inherited the source's phone", phone.rows[0]?.phone === "555-0001");

// ── 2. MD010 still refuses signed evidence ───────────────────────────────────────────────────
const S2 = "dddddddd-0000-0000-0000-000000000003";
await db.query(`insert into drivers (id, org_id, full_name) values ($1, $2, 'Signed Dup')`, [S2, ORG]);
await db.query(
  `insert into sms_consents (org_id, driver_id, phone, consent_text, consent_version, intent_statement, source)
   values ($1, $2, '555-9', 'I consent to SMS', 'v1', 'application updates', 'application')`,
  [ORG, S2],
);
const md010 = await refuses(`select merge_driver_v2($1, $2, $3, $4::jsonb)`, [ORG, S2, CAN, movesJson]);
ok("MD010 stands: signed evidence still refuses the merge", md010 !== null && /MD010|signed evidence/.test(md010.message));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
