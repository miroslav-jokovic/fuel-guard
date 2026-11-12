// Silvicom 360 — an office correction and its application_edits rows commit together (migration 0593,
// APPLICATION-FIX-PLAN Q-AM14 (a)).
//
// Before 0593 the change and the row the driver is shown for it were two PostgREST calls, so a failed
// second call left a change on file that screen 3.1 never showed. The property worth proving is the
// failure half: when the edit rows cannot be written, the correction is NOT made. Each of the four
// `correct_*` doors is driven once with rows that land and once with rows that are refused, and the
// write it wraps is read back unchanged after the refusal.
//
// Run:  node supabase/tests/application-corrections-one-transaction.test.mjs
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
const code = async (q, p = []) => {
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
for (const f of MIGRATIONS) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

const ORG = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Carrier') returning id`)).id;
const ACTOR = (await one(`insert into auth.users (email) values ('recruiter@example.com') returning id`)).id;
const applicant = async () => {
  const driver = (await one(`insert into drivers (org_id, full_name, status) values ($1, 'Applicant', 'applicant') returning id`, [ORG])).id;
  const inv = (await one(
    `insert into application_invitations (org_id, driver_id, token_hash, expires_at)
       values ($1, $2, md5(random()::text), now() + interval '14 days') returning id`,
    [ORG, driver],
  )).id;
  return { driver, inv };
};
const edits = async (inv) => all(
  `select path, before, after, note, withheld, edited_by from application_edits where invitation_id = $1 order by edited_at, id`, [inv],
);
const j = (v) => (v === null ? null : JSON.stringify(v));

// ── 1. The draft door ────────────────────────────────────────────────────────────────────────────
{
  const { driver, inv } = await applicant();
  await db.query(`select public.save_application_draft($1,$2,$3,$4::jsonb,'about',0)`, [ORG, inv, driver, j({ city: "Tulsa" })]);
  const correct = (payload, revision, rows) => db.query(
    `select public.correct_application_draft($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7) r`,
    [ORG, inv, driver, j(payload), revision, j(rows), ACTOR],
  );
  const draft = () => one(`select payload, revision, furthest_section from application_drafts where invitation_id = $1`, [inv]);

  const saved = (await correct({ city: "Tulsa, OK" }, 1, [{ path: ["city"], before: "Tulsa", after: "Tulsa, OK", note: null }])).rows[0].r;
  ok("draft: the correction is saved and returns the new revision", saved.revision === 2 && (await draft()).payload.city === "Tulsa, OK");
  ok("draft: …with its edit row, by the office's actor",
    j(await edits(inv)) === j([{ path: ["city"], before: "Tulsa", after: "Tulsa, OK", note: null, withheld: false, edited_by: ACTOR }]));
  ok("draft: an office correction leaves the applicant's furthest section where it was", (await draft()).furthest_section === "about");

  const refused = await code(
    `select public.correct_application_draft($1,$2,$3,$4::jsonb,2,$5::jsonb,$6)`,
    [ORG, inv, driver, j({ city: "Muskogee" }), j([{ path: "city", before: "Tulsa, OK", after: "Muskogee" }]), ACTOR],
  );
  ok("draft: a row whose path is not the contract's array is refused (AE001)", refused === "AE001");
  ok("draft: …and the correction went with it — the payload and revision are as they were",
    (await draft()).payload.city === "Tulsa, OK" && (await draft()).revision === 2);

  const blankNote = await code(
    `select public.correct_application_draft($1,$2,$3,$4::jsonb,2,$5::jsonb,$6)`,
    [ORG, inv, driver, j({ city: "Muskogee" }), j([{ path: ["city"], before: "Tulsa, OK", after: "Muskogee", note: "  " }]), ACTOR],
  );
  ok("draft: a row 0586's CHECK refuses (a blank reason) takes the correction with it", blankNote === "23514" && (await draft()).payload.city === "Tulsa, OK");
  ok("draft: neither refused attempt left a row", (await edits(inv)).length === 1);

  const stale = await code(
    `select public.correct_application_draft($1,$2,$3,$4::jsonb,1,$5::jsonb,$6)`,
    [ORG, inv, driver, j({ city: "Muskogee" }), j([{ path: ["city"], before: "Tulsa, OK", after: "Muskogee" }]), ACTOR],
  );
  ok("draft: the writer's own refusal passes through unchanged (DA041), and logs nothing",
    stale === "DA041" && (await edits(inv)).length === 1);

  await correct({ city: "Muskogee" }, 2, null);
  ok("draft: no rows to log (an unchanged answer) still saves, and writes none",
    (await draft()).payload.city === "Muskogee" && (await edits(inv)).length === 1);
}

// ── 2. The Part 1 door ───────────────────────────────────────────────────────────────────────────
{
  const { driver, inv } = await applicant();
  await db.query(
    `select public.record_applicant_intake($1,$2,$3,$4::jsonb,null,null,false)`,
    [ORG, inv, driver, j({ phone: "+15551112222", prior_positive_2y: false })],
  );
  const phone = async () => (await one(`select phone from application_intakes where invitation_id = $1`, [inv])).phone;
  const correct = (intake, rows) => code(
    `select public.correct_applicant_intake($1,$2,$3,$4::jsonb,null,null,$5::jsonb,$6)`,
    [ORG, inv, driver, j(intake), j(rows), ACTOR],
  );

  ok("intake: the correction and its row land together",
    (await correct({ phone: "+15553334444" }, [{ path: ["phone"], before: "+15551112222", after: "+15553334444" }])) === null
    && (await phone()) === "+15553334444" && (await edits(inv)).length === 1);
  ok("intake: …as the office's overwrite — the roster's phone moved too",
    (await one(`select phone from drivers where id = $1`, [driver])).phone === "+15553334444");
  ok("intake: a refused row (AE001) leaves Part 1 as it was",
    (await correct({ phone: "+15559990000" }, [{ path: null, after: "+15559990000" }])) === "AE001"
    && (await phone()) === "+15553334444" && (await one(`select phone from drivers where id = $1`, [driver])).phone === "+15553334444");
  ok("intake: a list that is not a list is refused the same way",
    (await correct({ phone: "+15559990000" }, { path: ["phone"] })) === "AE001" && (await phone()) === "+15553334444");

  // JSON null is SQL NULL, and a withheld row is stripped of whatever values it was handed.
  const both = await correct({ donor_gender: "female", address_line2: "Apt 4" }, [
    { path: ["donor_gender"], before: "male", after: "female", withheld: true },
    { path: ["address_line2"], before: null, after: "Apt 4" },
  ]);
  // One transaction stamps both rows with the same `edited_at`, so they are found by path.
  const at = async (key) => one(
    `select before, after, withheld, before is null as before_sql_null from application_edits
      where invitation_id = $1 and path = $2::jsonb`, [inv, j([key])],
  );
  const withheld = await at("donor_gender");
  const blank = await at("address_line2");
  ok("intake: a withheld row is written with no values, whatever the caller passed",
    both === null && withheld.withheld === true && withheld.before === null && withheld.after === null);
  ok("intake: a JSON null before is SQL NULL — \"left blank\" (0337)",
    blank.before_sql_null === true && blank.after === "Apt 4");
}

// ── 3. The identity door (a link without Part 1) ─────────────────────────────────────────────────
{
  const { driver, inv } = await applicant();
  await db.query(`select public.record_applicant_identity($1,$2,$3,'1980-01-02','D1234','OK',false)`, [ORG, inv, driver]);
  const dob = async () => (await one(`select to_char(date_of_birth,'YYYY-MM-DD') d from drivers where id = $1`, [driver])).d;
  const correct = (date, rows) => code(
    `select public.correct_applicant_identity($1,$2,$3,$4::date,'D1234','OK',$5::jsonb,$6)`,
    [ORG, inv, driver, date, j(rows), ACTOR],
  );
  ok("identity: the correction and its row land together",
    (await correct("1980-02-01", [{ path: ["date_of_birth"], before: "1980-01-02", after: "1980-02-01" }])) === null
    && (await dob()) === "1980-02-01" && (await edits(inv)).length === 1);
  ok("identity: a refused row leaves the date of birth, on the roster AND in the draft, as it was",
    (await correct("1999-09-09", [{ path: 3 }])) === "AE001" && (await dob()) === "1980-02-01"
    && (await one(`select payload->>'date_of_birth' d from application_drafts where invitation_id = $1`, [inv])).d === "1980-02-01");
  await db.query(`update application_invitations set submitted_at = now() where id = $1`, [inv]);
  ok("identity: the writer's own refusal passes through (AI003 once filed), and logs nothing",
    (await correct("1999-09-09", [{ path: ["date_of_birth"] }])) === "AI003" && (await edits(inv)).length === 1);
}

// ── 4. The SSN replace ───────────────────────────────────────────────────────────────────────────
{
  const { driver, inv } = await applicant();
  await db.query(`select public.record_applicant_ssn($1,$2,$3,'6789','v1.driver','applicant')`, [ORG, inv, driver]);
  const ssn = () => one(`select ssn_last4, ssn_sealed, entered_by from application_ssns where invitation_id = $1`, [inv]);
  const correct = (last4, rows) => code(
    `select public.correct_applicant_ssn($1,$2,$3,$4,'v1.office',$5::jsonb,$6)`,
    [ORG, inv, driver, last4, j(rows), ACTOR],
  );
  ok("ssn: a refused row leaves the driver's number as it was",
    (await correct("1234", [{ path: "ssn", withheld: true }])) === "AE001" && j(await ssn()) === j({ ssn_last4: "6789", ssn_sealed: "v1.driver", entered_by: "applicant" }));
  ok("ssn: the replacement and its withheld row land together, entered by the office",
    (await correct("1234", [{ path: ["ssn"], withheld: true }])) === null
    && j(await ssn()) === j({ ssn_last4: "1234", ssn_sealed: "v1.office", entered_by: "office" })
    && j(await edits(inv)) === j([{ path: ["ssn"], before: null, after: null, note: null, withheld: true, edited_by: ACTOR }]));
}

// ── 5. Who can reach them ────────────────────────────────────────────────────────────────────────
for (const sig of [
  "record_application_edits(uuid,uuid,jsonb,uuid)",
  "correct_application_draft(uuid,uuid,uuid,jsonb,int,jsonb,uuid)",
  "correct_applicant_intake(uuid,uuid,uuid,jsonb,jsonb,text[],jsonb,uuid)",
  "correct_applicant_identity(uuid,uuid,uuid,date,text,text,jsonb,uuid)",
  "correct_applicant_ssn(uuid,uuid,uuid,text,text,jsonb,uuid)",
]) {
  const can = async (role) => (await one(`select has_function_privilege($1, $2, 'execute') c`, [role, `public.${sig}`])).c;
  ok(`${sig.split("(")[0]}: the api may call it, a browser may not`,
    (await can("service_role")) === true && (await can("anon")) === false && (await can("authenticated")) === false);
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
