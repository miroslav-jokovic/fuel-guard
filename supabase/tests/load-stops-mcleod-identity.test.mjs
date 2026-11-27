// Silvicom 360 — a McLeod stop keeps one load_stops row for its whole life (migration 0660, S0a;
// docs/plans/mcleod/v2/T1-driver-and-data.md N-6; D-MK15, D-MK16).
//
// The promises, each held by `apply_mcleod_load_stops` because the projection that calls it (N-7) is
// the thing most likely to be wrong, and a phone that queued an action offline is the thing that pays:
//
//   · Identity: a projected stop is updated by (load_id, mcleod_stop_id), never deleted and
//     re-inserted, so its `load_stops.id` survives every sweep — and the driver's four columns
//     (status, arrived_at, completed_at, skip_reason) survive with it.
//   · The band (D-MK16): every row moves to seq + 1000 first, so an insertion mid-movement or a swap
//     applies in one call against the unique, non-deferrable `idx_load_stops_load_seq`, and the band
//     is empty when the call returns. Adopts `docs/plans/mcleod/api-kit-round4/pg/tail.mjs`'s sweeps.
//   · Kept, not deleted (D-MK15): a stop McLeod stops listing is stamped and moved to the tail, with
//     its photos' parent row intact; listed again, it is un-stamped.
//   · One load never aborts the batch: each load is its own sub-block, a refusal is returned by name,
//     and an over-long tail writes one `stop_mirror_refused` a day, closed by `exception_resolved`.
//
// The backfill is tested where it runs: the migrations up to 0659 are applied, fixtures inserted, and
// then 0660 onward — so "the backfill fills mcleod_stop_id" reads the migration's own UPDATE.
//
// Run:  node supabase/tests/load-stops-mcleod-identity.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations")).filter((f) => f.endsWith(".sql")).sort();
const S0A = MIGRATIONS.findIndex((f) => f.includes("_load_stops_mcleod_identity"));
if (S0A < 0) throw new Error("the S0a migration (*_load_stops_mcleod_identity.sql) is missing");

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
  create table storage.buckets (id text primary key, name text, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[], owner uuid,
    created_at timestamptz default now(), updated_at timestamptz default now());
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text,
    name text, owner uuid, owner_id text, created_at timestamptz default now());
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[] language sql immutable
  as $fn$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]; $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
  create role supabase_auth_admin nologin; create role authenticated nologin;
  create role anon nologin; create role service_role nologin bypassrls;
`);
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
  "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
  "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;",
);
const apply = async (files) => {
  for (const f of files) await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
};
await apply(MIGRATIONS.slice(0, S0A));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Carrier') returning id`)).id;
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Other carrier') returning id`)).id;

let n = 0;
const tmsLoad = async (org = ORG, externalId = null) => {
  n++;
  return (await one(
    `insert into loads (org_id, ref, status, source, provider, external_id)
     values ($1, $2, 'in_transit', 'tms', 'mcleod', $3) returning id`, [org, `MC-${n}`, externalId ?? `TMS:X${n}`])).id;
};
const row = async (load, seq, { mcleod = null, status = "pending", name = `old ${seq}`, org = ORG } = {}) =>
  (await one(
    `insert into load_stops (org_id, load_id, seq, kind, name, status, arrived_at, completed_at)
     values ($1, $2, $3, 'pickup', $4, $5,
             case when $5 <> 'pending' then now() end, case when $5 = 'completed' then now() end)
     returning id`, [org, load, seq, name, status])).id;

// ── 0. the backfill, before 0660 exists ──────────────────────────────────────────────────────────
// One raw movement with three stops (padded ids: the backfill trims), and a projected load whose
// raw movement is gone.
await db.query(`insert into mcleod_dispatch_movements (org_id, company_id, movement_id) values ($1, 'TMS', 'M100')`, [ORG]);
await db.query(
  `insert into mcleod_dispatch_stops (org_id, company_id, stop_id, movement_id, movement_sequence)
   values ($1, 'TMS', 'S-1  ', 'M100', 1), ($1, 'TMS', 'S-2', 'M100', 2), ($1, 'TMS', 'S-3', 'M100', 3)`, [ORG]);
const BF = await tmsLoad(ORG, "TMS:M100");
const BF1 = await row(BF, 1), BF2 = await row(BF, 2, { status: "completed" }), BF3 = await row(BF, 3);
const GONE = await tmsLoad(ORG, "TMS:M999");
const GONE1 = await row(GONE, 1, { status: "arrived" });

await apply(MIGRATIONS.slice(S0A));

const ids = async (load) =>
  Object.fromEntries((await all(`select id, mcleod_stop_id from load_stops where load_id = $1`, [load])).map((r) => [r.id, r.mcleod_stop_id]));
const bf = await ids(BF);
ok("the backfill fills mcleod_stop_id from raw by movement and sequence",
  bf[BF1] === "S-1" && bf[BF2] === "S-2" && bf[BF3] === "S-3", JSON.stringify(bf));

// ── the RPC ──────────────────────────────────────────────────────────────────────────────────────
const stop = (id, seq, extra = {}) => ({
  mcleod_stop_id: id, seq, kind: "pickup", name: `${id} name`, address_line: `${id} address`, city: "Dallas",
  state: "TX", postal_code: "75201", lat: 32.7, lon: -96.8, appointment_start: null, appointment_end: null,
  location_name: `${id} site`, location_code: id, external_status: "A", actual_arrival_at: null,
  actual_departure_at: null, eta_at: null, contact_name: null, contact_phone: null, po_number: null,
  required_photos: ["bol"], reference_numbers: [], ...extra,
});
// A call that RAISES is a whole batch lost — reported as nothing written, so the case FAILS, not the matrix.
const call = async (org, loads) => {
  try {
    return (await one(`select public.apply_mcleod_load_stops($1, $2::jsonb) r`, [org, JSON.stringify(loads)])).r;
  } catch (e) {
    return { written: [], refused: [], raised: e.message };
  }
};
const applyOne = (load, stops, org = ORG) => call(org, [{ load_id: load, stops }]);
const stops = (load) =>
  all(`select id, mcleod_stop_id m, seq, status, arrived_at, completed_at, skip_reason, address_line,
              mcleod_removed_at from load_stops where load_id = $1 order by seq`, [load]);
// A missing stop reads as {} rather than undefined, so a broken RPC FAILS a case instead of crashing the matrix.
const bySid = async (load) => {
  const m = Object.fromEntries((await stops(load)).map((r) => [r.m, r]));
  return new Proxy(m, { get: (t, k) => t[k] ?? {} });
};
const bandEmpty = async (load) => Number((await one(`select count(*) c from load_stops where load_id = $1 and seq >= 1000`, [load])).c) === 0;
const events = (load, kind) => all(`select id, payload, occurred_at from load_events where load_id = $1 and kind = $2 order by occurred_at, recorded_at`, [load, kind]);
let allBandEmpty = true;
const sweep = async (load, list, org = ORG) => {
  const r = await applyOne(load, list, org);
  allBandEmpty = allBandEmpty && (await bandEmpty(load));
  return r;
};

{
  const L = await tmsLoad();
  const r1 = await sweep(L, [stop("A", 1), stop("B", 2)]);
  const first = await bySid(L);
  await sweep(L, [stop("A", 1), stop("B", 2, { name: "B renamed" })]);
  const second = await bySid(L);
  ok("a projected stop keeps its id across two applies",
    r1.written.includes(L) && first.A.id === second.A.id && first.B.id === second.B.id && (await stops(L)).length === 2,
    JSON.stringify(r1));
}

{
  const L = await tmsLoad();
  await sweep(L, [stop("A", 1), stop("B", 2)]);
  await db.query(`update load_stops set status = 'skipped', arrived_at = '2026-11-20T10:00Z', completed_at = '2026-11-20T11:00Z',
                  skip_reason = 'closed' where load_id = $1 and mcleod_stop_id = 'A'`, [L]);
  await sweep(L, [stop("A", 1, { status: "pending", arrived_at: null, completed_at: null, skip_reason: null }), stop("B", 2)]);
  const a = (await bySid(L)).A;
  ok("the driver's status, arrived_at, completed_at and skip_reason survive an apply",
    a.status === "skipped" && a.arrived_at !== null && a.completed_at !== null && a.skip_reason === "closed", JSON.stringify(a));
}

{
  const L = await tmsLoad();
  const old = await row(L, 1, { status: "arrived" });
  await sweep(L, [stop("A", 1), stop("B", 2)]);
  const s = await stops(L);
  ok("a row without a McLeod stop id is claimed by its sequence, not duplicated",
    s.length === 2 && s[0].id === old && s[0].m === "A" && s[0].status === "arrived" && s[0].mcleod_removed_at === null,
    JSON.stringify(s));
}

{
  const L = await tmsLoad();
  await sweep(L, [stop("A", 1), stop("B", 2), stop("C", 3)]);
  const before = await bySid(L);
  await sweep(L, [stop("A", 1), stop("N", 2), stop("B", 3), stop("C", 4)]);
  const after = await bySid(L);
  ok("a stop inserted mid-movement shifts the later stops in one apply, ids unchanged",
    after.B.id === before.B.id && after.C.id === before.C.id && after.A.id === before.A.id &&
      after.N.seq === 2 && after.B.seq === 3 && after.C.seq === 4, JSON.stringify(after));
}

{
  const L = await tmsLoad();
  await sweep(L, [stop("A", 1), stop("B", 2), stop("C", 3)]);
  const before = await bySid(L);
  const r = await sweep(L, [stop("A", 1), stop("C", 2), stop("B", 3)]);
  const after = await bySid(L);
  ok("two stops swapped by dispatch are applied in one call",
    r.written.includes(L) && after.C.seq === 2 && after.B.seq === 3 && after.B.id === before.B.id && after.C.id === before.C.id,
    JSON.stringify(r));
}

{
  // tail.mjs sweep 1: C (worked) removed, D moves up to C's sequence.
  const L = await tmsLoad();
  await sweep(L, [stop("A", 1), stop("B", 2), stop("C", 3), stop("D", 4)]);
  await db.query(`update load_stops set status = 'completed', completed_at = now() where load_id = $1 and mcleod_stop_id in ('A','B','C')`, [L]);
  const r1 = await sweep(L, [stop("A", 1), stop("B", 2), stop("D", 3)]);
  const s1 = await bySid(L);
  ok("a worked stop McLeod removed no longer blocks the stop McLeod put at its sequence",
    r1.written.includes(L) && s1.D.seq === 3 && s1.C.seq === 4 && s1.C.status === "completed", JSON.stringify(s1));
  const r2 = await sweep(L, [stop("A", 1), stop("B", 2), stop("D", 3)]);
  const s2 = await bySid(L);
  ok("two consecutive sweeps after McLeod removed a worked stop both apply",
    r1.written.includes(L) && r2.written.includes(L) && s2.C.id === s1.C.id && s2.C.seq === 4 &&
      (await events(L, "stop_removed_in_mcleod")).length === 1, JSON.stringify(r2));
  // tail.mjs sweep 3: E added at 4, where removed C sits at the tail.
  const r3 = await sweep(L, [stop("A", 1), stop("B", 2), stop("D", 3), stop("E", 4)]);
  const s3 = await bySid(L);
  ok("a stop McLeod adds at a removed worked stop's old sequence is inserted",
    r3.written.includes(L) && s3.E.seq === 4 && s3.C.seq === 5 && s3.C.mcleod_removed_at !== null, JSON.stringify(s3));
  // tail.mjs sweep 4: swap D and E.
  const r4 = await sweep(L, [stop("A", 1), stop("B", 2), stop("E", 3), stop("D", 4)]);
  const s4 = await bySid(L);
  ok("…and a swap after it applies too (tail.mjs sweep 4)", r4.written.includes(L) && s4.E.seq === 3 && s4.D.seq === 4 && s4.C.seq === 5);
}

{
  // cD DR-2: worked B is re-sequenced; its row must carry B's address, not the stop that took its number.
  const L = await tmsLoad();
  await sweep(L, [stop("A", 1), stop("B", 2), stop("C", 3)]);
  await db.query(`update load_stops set status = 'completed', completed_at = now() where load_id = $1 and mcleod_stop_id = 'B'`, [L]);
  const bId = (await bySid(L)).B.id;
  await sweep(L, [stop("A", 1), stop("C", 2), stop("B", 3)]);
  const b = (await all(`select mcleod_stop_id m, seq, address_line from load_stops where id = $1`, [bId]))[0] ?? {};
  ok("a worked stop keeps its own McLeod stop's address after a re-sequence, never its sequence-neighbour's",
    b.m === "B" && b.seq === 3 && b.address_line === "B address", JSON.stringify(b));
}

{
  const L = await tmsLoad();
  await sweep(L, [stop("A", 1), stop("B", 2), stop("C", 3)]);
  await db.query(`update load_stops set status = 'arrived', arrived_at = now() where load_id = $1 and mcleod_stop_id = 'B'`, [L]);
  const bId = (await bySid(L)).B.id;
  const PHOTO = (await one(`insert into load_stop_photos (id, org_id, load_id, stop_id, slot, storage_path)
                            values (gen_random_uuid(), $1, $2, $3, 'bol', 'p/b.jpg') returning id`, [ORG, L, bId])).id;
  await sweep(L, [stop("A", 1), stop("C", 2)]);
  const s = await bySid(L);
  const ev = await events(L, "stop_removed_in_mcleod");
  ok("a stop McLeod no longer lists is kept, stamped and moved to the tail",
    s.B.id === bId && s.B.mcleod_removed_at !== null && s.B.seq === 3 && s.B.status === "arrived" &&
      (await all(`select 1 from load_stop_photos where id = $1`, [PHOTO])).length === 1 &&
      ev.length === 1 && ev[0]?.payload.stop_id === bId && ev[0].payload.mcleod_stop_id === "B" && ev[0].payload.driver_status === "arrived",
    JSON.stringify({ s, ev }));
  await sweep(L, [stop("A", 1), stop("B", 2), stop("C", 3)]);
  const back = await bySid(L);
  ok("a removed stop McLeod lists again is no longer removed",
    back.B.id === bId && back.B.mcleod_removed_at === null && back.B.seq === 2, JSON.stringify(back.B));
}

{
  // `allBandEmpty` covers every sweep above; this case also checks a load with only removed stops.
  const L = await tmsLoad();
  await sweep(L, [stop("A", 1), stop("B", 2)]);
  await sweep(L, []);
  ok("the band is empty after every apply", allBandEmpty && (await bandEmpty(L)) && (await stops(L)).every((r) => r.seq < 1000));
}

// ── refusals ─────────────────────────────────────────────────────────────────────────────────────
const bigLoad = async () => {
  const L = await tmsLoad();
  await db.query(
    `insert into load_stops (org_id, load_id, seq, kind, name, mcleod_stop_id)
     select $1, $2, g, 'dropoff', 'R'||g, 'R'||g from generate_series(1, 201) g`, [ORG, L]);
  return L;
};
{
  const BIG = await bigLoad();
  const GOOD = await tmsLoad();
  const before = await stops(BIG);
  const r = await call(ORG, [{ load_id: BIG, stops: [stop("Z", 1)] }, { load_id: GOOD, stops: [stop("A", 1)] }]);
  const after = await stops(BIG);
  ok("a load whose tail would pass 200 is refused by name and the rest of the batch applies",
    r.refused.some((x) => x.load_id === BIG && x.reason === "stop_tail_over_200") && r.written.includes(GOOD) &&
      (await stops(GOOD)).length === 1 && JSON.stringify(after) === JSON.stringify(before) &&
      (await events(BIG, "stop_removed_in_mcleod")).length === 0,
    JSON.stringify(r));

  await applyOne(BIG, [stop("Z", 1)]);
  const once = (await events(BIG, "stop_mirror_refused")).length;
  const STALE = await bigLoad();
  await db.query(`insert into load_events (org_id, load_id, actor_role, kind, payload, occurred_at)
                  values ($1, $2, 'system', 'stop_mirror_refused', '{}'::jsonb, now() - interval '25 hours')`, [ORG, STALE]);
  await applyOne(STALE, [stop("Z", 1)]);
  await applyOne(STALE, [stop("Z", 1)]);
  ok("a refused load writes one stop_mirror_refused event a day",
    once === 1 && (await events(STALE, "stop_mirror_refused")).length === 2, `once=${once}`);

  // 190 of BIG's 201 stops listed again at 1..190 leaves a tail of 11: it applies.
  const list = Array.from({ length: 190 }, (_, i) => stop(`R${i + 1}`, i + 1));
  const r2 = await applyOne(BIG, list);
  const refusedEv = await events(BIG, "stop_mirror_refused");
  const resolved = await events(BIG, "exception_resolved");
  await applyOne(BIG, list);
  ok("a load that applies after a refusal closes it with exception_resolved",
    r2.written.includes(BIG) && resolved.length === 1 && resolved[0]?.payload.resolves === refusedEv.at(-1)?.id &&
      resolved[0]?.payload.kind === "stop_mirror_refused" && resolved[0]?.payload.by === "mirror" &&
      (await events(BIG, "exception_resolved")).length === 1,
    JSON.stringify({ r2, resolved }));
}

{
  const THEIRS = await tmsLoad(OTHER);
  const r = await applyOne(THEIRS, [stop("A", 1)], ORG);
  ok("a load of another organization is refused",
    r.refused.some((x) => x.load_id === THEIRS && x.reason === "not_tms_in_org") && (await stops(THEIRS)).length === 0, JSON.stringify(r));
  const MAN = (await one(`insert into loads (org_id, ref, status) values ($1, 'MAN-1', 'draft') returning id`, [ORG])).id;
  const r2 = await applyOne(MAN, [stop("A", 1)]);
  ok("a manual load is refused",
    r2.refused.some((x) => x.load_id === MAN && x.reason === "not_tms_in_org") && (await stops(MAN)).length === 0, JSON.stringify(r2));
}

{
  const before = await stops(GONE);
  await sweep(GONE, [stop("G1", 1), stop("G2", 2)]);
  const after = await bySid(GONE);
  ok("a projected load whose raw movement is gone keeps mcleod_stop_id null and is claimed by seq on its next apply",
    before.length === 1 && before[0].m === null && after.G1.id === GONE1 && after.G1.status === "arrived" &&
      (await stops(GONE)).length === 2, JSON.stringify({ before, after }));
}

ok("load_events still accepts stop_photo_added",
  (await sqlstate(`insert into load_events (org_id, load_id, kind) values ($1, $2, 'stop_photo_added')`, [ORG, BF])) === null);

// ── the door: service role only ──────────────────────────────────────────────────────────────────
const canRun = async (role) =>
  (await one(`select has_function_privilege($1, 'public.apply_mcleod_load_stops(uuid, jsonb)', 'execute') ok`, [role])).ok;
ok("only the service role may call apply_mcleod_load_stops",
  (await canRun("service_role")) && !(await canRun("anon")) && !(await canRun("authenticated")));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
