// Silvicom 360 — toll transponders and their dated assignments (migration 0622; TOLLS-PER-TRUCK-PLAN.md
// TL1, D-TL1..D-TL4).
//
// 1. A tag is registered once per provider per org; PrePass and lower case are refused.
// 2. A tag is on at most one truck at any instant, across its whole history (TL001), even backdated.
// 3. A move closes the old row and opens the new one atomically; a move dated before the current
//    truck got the tag is refused (TL005); a move to the same truck changes nothing.
// 4. Rows are never edited (TL002): only closed, or voided — and a voided row frees its time.
// 5. A retired tag closes its open row and takes no new assignment (TL004).
// 6. Another org's truck or tag is refused (TL003).
// 7. RLS on with no client policy; the writers are closed to clients; a truck with history cannot go.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0,
  fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
};
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
/** Run a statement and report the SQLSTATE it raised, or null when it succeeded. */
const refuses = async (q, p = []) => {
  try {
    await db.query(q, p);
    return null;
  } catch (e) {
    return e.code ?? "unknown";
  }
};

// Supabase-managed schemas, shimmed identically to unit-tags.test.mjs.
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
`);
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS) await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Fleet') returning id`)).id;
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Rival') returning id`)).id;
const truck = async (org, unit) =>
  (await one(`insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1,$2,240) returning id`, [org, unit])).id;
const T654 = await truck(ORG, "654");
const T702 = await truck(ORG, "702");
const T777 = await truck(ORG, "777");
const RIVAL_TRUCK = await truck(OTHER, "900");

const register = (org, provider, tag, vehicle, at) =>
  db.query(`select register_toll_transponder($1,$2,$3,null,null,$4,$5,null) as id`, [org, provider, tag, vehicle, at]).then((r) => r.rows[0].id);
const move = (org, tag, vehicle, at) => refuses(`select move_toll_transponder($1,$2,$3,$4,null)`, [org, tag, vehicle, at]);
const rows = async (tag) =>
  (await db.query(
    `select vehicle_id, valid_from, valid_to, voided_at from toll_transponder_assignments where transponder_id = $1 order by valid_from, created_at`,
    [tag],
  )).rows;
const iso = (d) => (d ? new Date(d).toISOString() : null);

// ── 1: registration ─────────────────────────────────────────────────────────────────────────
const EZ = await register(ORG, "ezpass", "00812345678", T654, "2026-06-01T05:00:00Z");
ok("an E-ZPass tag registers onto a truck", Boolean(EZ));
ok("its first assignment is open from the given time", (await rows(EZ)).length === 1 && (await rows(EZ))[0].valid_to === null);
ok(
  "the same tag cannot be registered twice for one provider",
  (await refuses(`select register_toll_transponder($1,'ezpass','00812345678',null,null,null,now(),null)`, [ORG])) === "23505",
);
ok(
  "the same number under another provider is a different tag",
  (await refuses(`select register_toll_transponder($1,'ktag','00812345678',null,null,null,now(),null)`, [ORG])) === null,
);
ok(
  "another org may hold the same number",
  (await refuses(`select register_toll_transponder($1,'ezpass','00812345678',null,null,null,now(),null)`, [OTHER])) === null,
);
ok(
  "PrePass is not a toll provider (owner 2026-11-16)",
  (await refuses(`select register_toll_transponder($1,'prepass','55555555',null,null,null,now(),null)`, [ORG])) === "23514",
);
ok(
  "a tag number the API did not normalise is refused",
  (await refuses(`select register_toll_transponder($1,'ezpass','008-1234 5678',null,null,null,now(),null)`, [ORG])) === "23514",
);
ok(
  "a tag registered with no truck has no assignment",
  Number((await one(`select count(*) from toll_transponder_assignments a join toll_transponders t on t.id = a.transponder_id where t.provider = 'ktag'`)).count) === 0,
);

// ── 2 + 3: moves ────────────────────────────────────────────────────────────────────────────
ok("a move to another truck succeeds", (await move(ORG, EZ, T702, "2026-06-10T14:00:00Z")) === null);
let h = await rows(EZ);
ok(
  "the old row closed exactly where the new one opens",
  h.length === 2 && iso(h[0].valid_to) === "2026-06-10T14:00:00.000Z" && iso(h[1].valid_from) === "2026-06-10T14:00:00.000Z" && h[1].valid_to === null,
);
ok("a move to the truck it is already on changes nothing", (await move(ORG, EZ, T702, "2026-06-12T00:00:00Z")) === null && (await rows(EZ)).length === 2);
ok("a move dated before the current truck got it is refused", (await move(ORG, EZ, T777, "2026-06-09T00:00:00Z")) === "TL005");
ok("a move dated at the same instant is refused too", (await move(ORG, EZ, T777, "2026-06-10T14:00:00Z")) === "TL005");
ok("after a refused move the history is unchanged", (await rows(EZ)).length === 2);

ok("taking a tag off its truck closes the open row", (await move(ORG, EZ, null, "2026-06-20T00:00:00Z")) === null);
h = await rows(EZ);
ok("…and opens nothing", h.length === 2 && h.every((r) => r.valid_to !== null));

// A backdated insert straight into the table must still meet the whole history, not only the open row.
const backdate = (vehicle, from, to) =>
  refuses(`insert into toll_transponder_assignments (org_id, transponder_id, vehicle_id, valid_from, valid_to) values ($1,$2,$3,$4,$5)`, [ORG, EZ, vehicle, from, to]);
ok("a backdated row overlapping a closed one is refused", (await backdate(T777, "2026-06-05T00:00:00Z", "2026-06-07T00:00:00Z")) === "TL001");
ok("a row touching a closed one end-to-start is accepted", (await backdate(T777, "2026-06-20T00:00:00Z", "2026-06-25T00:00:00Z")) === null);
ok("an open row starting inside a closed one is refused", (await backdate(T654, "2026-06-24T00:00:00Z", null)) === "TL001");
ok("a row ending before it starts is refused", (await backdate(T654, "2026-07-02T00:00:00Z", "2026-07-01T00:00:00Z")) === "23514");
ok("a second open row is refused", (await move(ORG, EZ, T654, "2026-07-01T00:00:00Z")) === null && (await backdate(T702, "2026-08-01T00:00:00Z", null)) !== null);

// ── 4: never edited ─────────────────────────────────────────────────────────────────────────
const first = (await one(`select id from toll_transponder_assignments where transponder_id = $1 order by valid_from limit 1`, [EZ])).id;
ok("an assignment's truck is never rewritten", (await refuses(`update toll_transponder_assignments set vehicle_id = $2 where id = $1`, [first, T777])) === "TL002");
ok("its start is never rewritten", (await refuses(`update toll_transponder_assignments set valid_from = valid_from - interval '1 day' where id = $1`, [first])) === "TL002");
ok("a closed row's end is never moved", (await refuses(`update toll_transponder_assignments set valid_to = valid_to + interval '1 hour' where id = $1`, [first])) === "TL002");
ok(
  "voiding needs a reason",
  (await refuses(`update toll_transponder_assignments set voided_at = now() where id = $1`, [first])) === "23514",
);
ok("a wrong assignment is voided with a reason", (await refuses(`select void_toll_transponder_assignment($1,$2,'entered on the wrong truck',null)`, [ORG, first])) === null);
ok("a voided row is never changed again", (await refuses(`update toll_transponder_assignments set void_reason = 'x' where id = $1`, [first])) === "TL002");
ok("voiding twice is refused", (await refuses(`select void_toll_transponder_assignment($1,$2,'again',null)`, [ORG, first])) === "TL003");
ok("a voided row frees its time for the right truck", (await backdate(T777, "2026-06-01T05:00:00Z", "2026-06-10T14:00:00Z")) === null);

// ── 5: retirement ───────────────────────────────────────────────────────────────────────────
ok("retiring a tag at or before its open row's start is refused", (await refuses(`select retire_toll_transponder($1,$2,'2026-07-01T00:00:00Z','lost',null)`, [ORG, EZ])) === "TL005");
ok("a lost tag retires", (await refuses(`select retire_toll_transponder($1,$2,'2026-08-15T00:00:00Z','lost',null)`, [ORG, EZ])) === null);
ok(
  "retiring closed its open row at the same instant",
  await (async () => {
    const r = await one(
      `select count(*) filter (where valid_to is null and voided_at is null) as open, max(valid_to) as last
       from toll_transponder_assignments where transponder_id = $1 and voided_at is null`,
      [EZ],
    );
    return Number(r.open) === 0 && iso(r.last) === "2026-08-15T00:00:00.000Z";
  })(),
);
ok("a retired tag cannot be moved onto a truck", (await move(ORG, EZ, T702, "2026-09-01T00:00:00Z")) === "TL004");
ok("nor given a row after its retirement directly", (await backdate(T702, "2026-09-01T00:00:00Z", null)) === "TL004");
ok("retirement needs a known reason", (await refuses(`update toll_transponders set retired_at = now(), retired_reason = 'sold' where id = $1`, [EZ])) === "23514");

// ── 6: one org ──────────────────────────────────────────────────────────────────────────────
const KT = await register(ORG, "ktag", "KT0000777", T777, "2026-06-01T00:00:00Z");
ok("a tag cannot move onto another org's truck", (await move(ORG, KT, RIVAL_TRUCK, "2026-07-01T00:00:00Z")) === "TL003");
ok("another org cannot move this org's tag", (await move(OTHER, KT, RIVAL_TRUCK, "2026-07-01T00:00:00Z")) === "TL003");
ok(
  "another org cannot void this org's assignment",
  (await refuses(
    `select void_toll_transponder_assignment($1,(select id from toll_transponder_assignments where transponder_id = $2),'x',null)`,
    [OTHER, KT],
  )) === "TL003",
);
ok(
  "registering onto another org's truck is refused and leaves no tag behind",
  (await refuses(`select register_toll_transponder($1,'expresstoll','ET1001',null,null,$2,now(),null)`, [ORG, RIVAL_TRUCK])) === "TL003" &&
    Number((await one(`select count(*) from toll_transponders where tag_number = 'ET1001'`)).count) === 0,
);

// ── 7: access ───────────────────────────────────────────────────────────────────────────────
for (const t of ["toll_transponders", "toll_transponder_assignments"]) {
  ok(`${t}: row level security is on`, (await one(`select relrowsecurity from pg_class where relname = $1`, [t])).relrowsecurity === true);
  ok(`${t}: no client policy exists`, Number((await one(`select count(*) from pg_policies where tablename = $1`, [t])).count) === 0);
}
for (const fn of [
  "register_toll_transponder(uuid,text,text,text,text,uuid,timestamptz,uuid)",
  "move_toll_transponder(uuid,uuid,uuid,timestamptz,uuid)",
  "retire_toll_transponder(uuid,uuid,timestamptz,text,uuid)",
  "void_toll_transponder_assignment(uuid,uuid,text,uuid)",
  "guard_toll_transponder_assignment()",
]) {
  ok(`${fn.split("(")[0]} is closed to clients`, (await one(`select has_function_privilege('authenticated', $1, 'execute') as x`, [fn])).x === false);
}
const del = await refuses(`delete from vehicles where id = $1`, [T777]);
ok("a truck with toll history cannot be deleted", del === "23001", del);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
