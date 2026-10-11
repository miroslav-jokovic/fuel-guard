// Silvicom 360 — Part 1 intake matrix (migration 0376, APPLICATION-FLOW-V2-PLAN.md §8.2, D-AW3/D-AW4).
//
// `record_applicant_intake` is the one writer of Part 1 and `complete_applicant_intake` files its
// documents. Three properties matter and each is a case below: the refusals (AI001–AI004, AI007–AI009),
// the drivers row rule inherited from 0365 (fill-only for the applicant, overwrite for the office), and
// promotion — exactly once, and never the selfie.
//
// (Named `-v2` because `application-intake.test.mjs` is H5's submission matrix, 0220, and stays as is.)
//
// Run:  node supabase/tests/application-intake-v2.test.mjs
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
const count = async (q, p = []) => Number((await one(q, p)).n);
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
const OTHER = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Other') returning id`)).id;
const driver = async (org, extra = "") =>
  (await one(`insert into drivers (org_id, full_name, status ${extra ? "," + extra.split("=")[0] : ""})
              values ($1, 'Applicant', 'applicant' ${extra ? ",'" + extra.split("=")[1] + "'" : ""}) returning id`, [org])).id;
const invite = async (org, drv, expires = "now() + interval '14 days'") =>
  (await one(`insert into application_invitations (org_id, driver_id, token_hash, expires_at)
              values ($1, $2, md5(random()::text), ${expires}) returning id`, [org, drv])).id;

const INTAKE = {
  phone: "+13125550100", address_line1: "1 Main St", city: "Chicago", state: "IL", postal_code: "60601",
  prior_positive_2y: false, dot_program_30d: true, dot_tested_6m: true, dot_random_12m: false,
  date_of_birth: "1980-04-01", cdl_class: "A",
};
const LICENCES = [
  { position: 0, state_code: "IL", licence_number: "D1234567", expires_on: "2029-01-31" },
  { position: 1, state_code: "WI", licence_number: "W7654321", expires_on: "2024-06-30" },
];
const intake = (org, inv, drv, body, lic, endorsements, overwrite) =>
  db.query(`select public.record_applicant_intake($1,$2,$3,$4::jsonb,$5::jsonb,$6::text[],$7) as r`,
    [org, inv, drv, body === null ? null : JSON.stringify(body), lic === null ? null : JSON.stringify(lic), endorsements, overwrite]);
const intakeCode = async (...a) => { try { await intake(...a); return null; } catch (e) { return e.code; } };

// ── 1. Refusals ──────────────────────────────────────────────────────────────────────────────────
const D1 = await driver(ORG);
const I1 = await invite(ORG, D1);
ok("AI001: an invitation of another org is not found",
  (await intakeCode(OTHER, I1, D1, INTAKE, LICENCES, null, false)) === "AI001");
ok("AI001: an invitation of another driver is not found",
  (await intakeCode(ORG, I1, await driver(ORG), INTAKE, LICENCES, null, false)) === "AI001");
const DX = await driver(ORG);
const IX = await invite(ORG, DX, "now() - interval '1 day'");
ok("AI002: an expired link refuses the applicant", (await intakeCode(ORG, IX, DX, INTAKE, LICENCES, null, false)) === "AI002");
ok("…but not the office's correction (0365's reading)", (await intakeCode(ORG, IX, DX, INTAKE, LICENCES, null, true)) === null);
const DR = await driver(ORG);
const IR = await invite(ORG, DR);
await db.query(`update application_invitations set revoked_at = now() where id = $1`, [IR]);
ok("AI002: a revoked link refuses even the office", (await intakeCode(ORG, IR, DR, INTAKE, LICENCES, null, true)) === "AI002");
const DS = await driver(ORG);
const IS = await invite(ORG, DS);
await db.query(`update application_invitations set submitted_at = now() where id = $1`, [IS]);
ok("AI003: a filed application's Part 1 is frozen", (await intakeCode(ORG, IS, DS, INTAKE, LICENCES, null, true)) === "AI003");
ok("AI004: a payload that is not an object",
  (await code(`select public.record_applicant_intake($1,$2,$3,'[]'::jsonb,null,null,false)`, [ORG, I1, D1])) === "AI004");
ok("AI004: a licence without a number",
  (await intakeCode(ORG, I1, D1, INTAKE, [{ position: 0, state_code: "IL" }], null, false)) === "AI004");
ok("AI009: the §40.25(j) answer missing on the first write refuses",
  (await intakeCode(ORG, I1, D1, { ...INTAKE, prior_positive_2y: null }, LICENCES, null, false)) === "AI009");
ok("…and a refused call wrote nothing (one transaction)",
  (await count(`select count(*) n from application_intakes where invitation_id = $1`, [I1])) === 0);

// ── 2. The write, and the drivers row (fill-only for the applicant) ──────────────────────────────
const r1 = (await intake(ORG, I1, D1, INTAKE, LICENCES, ["H", "n", "h"], false)).rows[0].r;
ok("the intake row is written", !!r1.intake_id);
ok("both licences are written", r1.licence_count === 2);
const d1 = await one(`select phone, city, state, postal_code, cdl_class, cdl_expires_at::text e, date_of_birth::text dob,
                             cdl_number, cdl_state from drivers where id = $1`, [D1]);
ok("drivers gets the contact, CDL class and expiry", d1.phone === "+13125550100" && d1.city === "Chicago" && d1.cdl_class === "A" && d1.e === "2029-01-31");
ok("DOB and the current licence go through record_applicant_identity",
  d1.dob === "1980-04-01" && d1.cdl_number === "D1234567" && d1.cdl_state === "IL" && r1.identity?.draft_id);
const draft = await one(`select payload from application_drafts where invitation_id = $1`, [I1]);
ok("…which patches the draft in the same transaction (one writer, D-AF8)", draft?.payload?.cdl_number === "D1234567");
ok("declared endorsements are kept on the intake, upper-cased and de-duplicated",
  JSON.stringify((await one(`select endorsements from application_intakes where invitation_id = $1`, [I1])).endorsements) === '["H","N"]');

// A second applicant write: present keys only, and a value already on `drivers` wins.
await db.query(`update drivers set city = 'Office-Corrected' where id = $1`, [D1]);
const r2 = (await intake(ORG, I1, D1, { city: "Typo-ville" }, null, null, false)).rows[0].r;
ok("fill-only: the applicant does not overwrite a drivers value", (await one(`select city from drivers where id=$1`, [D1])).city === "Office-Corrected");
ok("…and is told which column kept its value (names only)", JSON.stringify(r2.kept_existing) === '["city"]');
ok("absent keys keep what the intake row had",
  (await one(`select phone, city from application_intakes where invitation_id=$1`, [I1])).phone === "+13125550100");
ok("p_licences null leaves the licence list alone", r2.licence_count === 2);
const r3 = (await intake(ORG, I1, D1, { city: "Evanston" }, null, null, true)).rows[0].r;
ok("overwrite: the office's correction reaches drivers", (await one(`select city from drivers where id=$1`, [D1])).city === "Evanston" && r3.kept_existing.length === 0);
ok("an endorsement outside 0098's letters is refused by the intake CHECK",
  (await intakeCode(ORG, I1, D1, {}, null, ["Z"], false)) === "23514");
ok("a phone outside +1 E.164 is refused by the intake CHECK",
  (await intakeCode(ORG, I1, D1, { phone: "5550100" }, null, null, false)) === "23514");
ok("the FCRA summary instant is the server's, set with the version",
  (await intake(ORG, I1, D1, { fcra_summary_version: "fcra-2023" }, null, null, false)) &&
  (await one(`select fcra_summary_shown_at is not null s from application_intakes where invitation_id=$1`, [I1])).s === true);

// ── 3. Completion: AI007, promotion exactly once, never the selfie ───────────────────────────────
const complete = (inv, drv, captures) =>
  db.query(`select public.complete_applicant_intake($1,$2,$3,$4::jsonb) as t`, [ORG, inv, drv, JSON.stringify(captures)]);
const completeCode = async (...a) => { try { await complete(...a); return null; } catch (e) { return e.code; } };
const stage = async (inv, drv, slot) =>
  (await one(`select (public.stage_application_capture($1,$2,$3,gen_random_uuid(),$4,$5,'image/jpeg',100,'ab') ->> 'capture_id')::uuid id`,
    [ORG, inv, drv, slot, `${ORG}/${inv}/${slot}.jpg`])).id;

ok("AI007: no captures yet", (await completeCode(I1, D1, [])) === "AI007");
const front = await stage(I1, D1, "cdl_front");
const back = await stage(I1, D1, "cdl_back");
ok("AI007: CDL front and back but no medical card and none declared pending", (await completeCode(I1, D1, [])) === "AI007");
await intake(ORG, I1, D1, { medical_card_pending: true }, null, null, false);
const selfie = await stage(I1, D1, "selfie");
const D2 = await driver(ORG);
const I2 = await invite(ORG, D2);
await intake(ORG, I2, D2, INTAKE, LICENCES, null, false);
await stage(I2, D2, "cdl_front"); await stage(I2, D2, "cdl_back");
ok("AI007: the FCRA summary was never shown", (await completeCode(I2, D2, [])) === "AI007");

const caps = [
  { capture_id: front, kind: "cdl", page: 1, storage_path: `${ORG}/driver/${D1}/${front}.jpg` },
  { capture_id: back, kind: "cdl", page: 2, storage_path: `${ORG}/driver/${D1}/${back}.jpg` },
  { capture_id: selfie, kind: "other", page: 1, storage_path: `${ORG}/driver/${D1}/${selfie}.jpg` },
];
const t1 = (await complete(I1, D1, caps)).rows[0].t;
ok("completion stamps intake_completed_at", !!t1 &&
  (await one(`select intake_completed_at is not null s from application_invitations where id=$1`, [I1])).s);
ok("the CDL pages are promoted into documents",
  (await count(`select count(*) n from documents where id in ($1,$2)`, [front, back])) === 2);
ok("…and each capture names its document",
  (await count(`select count(*) n from application_captures where id in ($1,$2) and promoted_document_id = id`, [front, back])) === 2);
ok("the selfie is NEVER promoted, even when listed",
  (await count(`select count(*) n from documents where id = $1`, [selfie])) === 0 &&
  (await one(`select promoted_document_id from application_captures where id=$1`, [selfie])).promoted_document_id === null);
const docsBefore = await count(`select count(*) n from documents where org_id = $1`, [ORG]);
const t2 = (await complete(I1, D1, caps)).rows[0].t;
ok("a second completion is idempotent: same stamp, no new document",
  String(t2) === String(t1) && (await count(`select count(*) n from documents where org_id = $1`, [ORG])) === docsBefore);
ok("AI008: after completion the applicant cannot rewrite Part 1",
  (await intakeCode(ORG, I1, D1, { city: "X" }, LICENCES, null, false)) === "AI008");
ok("…the office still can", (await intakeCode(ORG, I1, D1, { city: "Skokie" }, LICENCES, null, true)) === null);

// Q-AW36: the office replaces the CURRENT licence after Part 1 is finished. Position 0 is what the
// function hands `record_applicant_identity`, so `drivers` and the draft move with the list — the one
// property the API's v2 identity correction relies on (`correctIdentityThroughPartOne`).
await intake(ORG, I1, D1, { date_of_birth: "1980-04-02" }, [
  { position: 0, state_code: "IN", licence_number: "IN-CORRECTED", expires_on: "2030-02-28" },
  LICENCES[1],
], null, true);
const corrected = await one(
  `select to_char(date_of_birth,'YYYY-MM-DD') dob, cdl_number, cdl_state, to_char(cdl_expires_at,'YYYY-MM-DD') exp
     from drivers where id = $1`, [D1]);
ok("an office list replacement moves the CDL on drivers — number, state, expiry and date of birth",
  corrected.cdl_number === "IN-CORRECTED" && corrected.cdl_state === "IN" && corrected.exp === "2030-02-28"
    && corrected.dob === "1980-04-02");
ok("…and the draft, in the same transaction",
  (await one(`select payload from application_drafts where invitation_id = $1`, [I1]))?.payload?.cdl_number === "IN-CORRECTED");
ok("…and the list holds exactly what was sent, the old licence gone",
  (await count(`select count(*)::int n from application_intake_licences where invitation_id = $1 and licence_number = 'D1234567'`, [I1])) === 0
    && (await count(`select count(*)::int n from application_intake_licences where invitation_id = $1`, [I1])) === 2);
ok("a capture of another invitation cannot be promoted through this one",
  (await (async () => {
    const other = await stage(I2, D2, "medical_card");
    await intake(ORG, I2, D2, { fcra_summary_version: "fcra-2023" }, null, null, false);
    await complete(I2, D2, [{ capture_id: front, kind: "cdl", page: 1, storage_path: "x" },
                            { capture_id: other, kind: "medical_card", page: 1, storage_path: `${ORG}/driver/${D2}/${other}.jpg` }]);
    return (await count(`select count(*) n from documents where subject_id = $1`, [D2])) === 1;
  })()));

// ── 4. confirm_application_capture ───────────────────────────────────────────────────────────────
const H = "a".repeat(64);
ok("confirm records the server hash and metrics",
  (await code(`select public.confirm_application_capture($1,$2,$3,$4,2048,'{"sharpness":0.8}'::jsonb)`, [ORG, I1, front, H])) === null &&
  (await one(`select server_sha256, bytes, verified_at is not null v from application_captures where id=$1`, [front])).v === true);
ok("DA042: confirming a capture of another invitation",
  (await code(`select public.confirm_application_capture($1,$2,$3,$4,null,null)`, [ORG, I2, front, H])) === "DA042");
ok("a server hash that is not hex SHA-256 is refused",
  (await code(`select public.confirm_application_capture($1,$2,$3,'nope',null,null)`, [ORG, I1, front])) === "23514");

// ── 5. Guards and grants ─────────────────────────────────────────────────────────────────────────
// As a browser session would arrive: JWT claims set for the transaction. RLS aside (the superuser
// harness bypasses it), the trigger alone must refuse.
const asClient = async (sql) => {
  try {
    await db.exec(`begin; select set_config('request.jwt.claims','{"role":"authenticated","user_role":"admin","org_id":"${ORG}"}',true); ${sql}; commit;`);
    return null;
  } catch (e) { await db.exec("rollback"); return e.code; }
};
ok("a JWT-bearing writer is refused on application_intakes (AI010)", (await asClient("update application_intakes set city = 'x'")) === "AI010");
ok("…and on application_intake_licences (AI011)", (await asClient("delete from application_intake_licences")) === "AI011");
for (const sig of [
  "record_applicant_intake(uuid,uuid,uuid,jsonb,jsonb,text[],boolean)",
  "complete_applicant_intake(uuid,uuid,uuid,jsonb)",
  "confirm_application_capture(uuid,uuid,uuid,text,bigint,jsonb)",
]) {
  const g = await one(`select has_function_privilege('anon', 'public.${sig}', 'execute') a,
                              has_function_privilege('authenticated', 'public.${sig}', 'execute') u,
                              has_function_privilege('service_role', 'public.${sig}', 'execute') s`);
  ok(`${sig.split("(")[0]}: anon and authenticated cannot execute, service_role can`, !g.a && !g.u && g.s);
}

// ── 6. Draft revisions (AW10): the 6-argument save_application_draft ─────────────────────────────
const save6 = (inv, drv, payload, expected) =>
  db.query(`select public.save_application_draft($1,$2,$3,$4::jsonb,'identity',$5) as r`,
    [ORG, inv, drv, JSON.stringify(payload), expected]);
const save6Code = async (...a) => { try { await save6(...a); return null; } catch (e) { return e.code; } };
const D6 = await driver(ORG);
const I6 = await invite(ORG, D6);
ok("DA041: a first save that expects an existing draft", (await save6Code(I6, D6, { a: 1 }, 3)) === "DA041");
const s1 = (await save6(I6, D6, { a: 1 }, 0)).rows[0].r;
ok("a first save expecting revision 0 creates the draft at revision 1", s1.revision === 1 && !!s1.draft_id);
const s2 = (await save6(I6, D6, { a: 2 }, 1)).rows[0].r;
ok("a save against the current revision increments it", s2.revision === 2);
ok("DA041: a replay of an older copy is refused", (await save6Code(I6, D6, { a: "stale" }, 1)) === "DA041");
ok("…and did not overwrite the newer save",
  (await one(`select payload from application_drafts where invitation_id=$1`, [I6])).payload.a === 2);
await db.query(`update application_drafts set payload = '{"a":3}'::jsonb where invitation_id = $1`, [I6]);
ok("a write by another path still moves the revision (the trigger counts every writer)",
  (await one(`select revision from application_drafts where invitation_id=$1`, [I6])).revision === 3);
ok("…so a copy taken before it is now stale", (await save6Code(I6, D6, { a: 4 }, 2)) === "DA041");
ok("the old 5-argument key set resolves to nothing — M2b dropped it (42883)",
  (await code(`select public.save_application_draft(p_org => $1, p_invitation => $2, p_driver => $3, p_payload => '{}'::jsonb, p_section => null)`,
    [ORG, I6, D6])) === "42883");
const rev = (await one(`select revision from application_drafts where invitation_id=$1`, [I6])).revision;
ok("the new key set resolves to exactly one function",
  (await code(`select public.save_application_draft(p_org => $1, p_invitation => $2, p_driver => $3, p_payload => '{}'::jsonb,
     p_section => null, p_expected_revision => $4)`, [ORG, I6, D6, rev])) === null);
{
  const sig = "save_application_draft(uuid,uuid,uuid,jsonb,text,int)";
  const g = await one(`select has_function_privilege('anon', 'public.${sig}', 'execute') a,
                              has_function_privilege('authenticated', 'public.${sig}', 'execute') u,
                              has_function_privilege('service_role', 'public.${sig}', 'execute') s,
                              (select pronargdefaults from pg_proc where oid = 'public.${sig}'::regprocedure) d`);
  ok("save_application_draft (new signature): anon and authenticated cannot execute, service_role can, no defaults",
    !g.a && !g.u && g.s && g.d === 0);
}

// ── 7. The invitation's new stamps and the kinds (D-AW5, A-10) ───────────────────────────────────
ok("unlock_failures cannot go negative",
  (await code(`update application_invitations set unlock_failures = -1 where id = $1`, [I6])) === "23514");

// ── 7a. 0381's sign-code columns were dropped by 0382 (Q-AW25 withdrawn); handbook-signing.test.mjs
// asserts they are gone.

ok("clearinghouse_portal_consent is a filable qualification record kind",
  (await code(`insert into qualification_records (org_id, driver_id, kind, occurred_on, result)
               values ($1,$2,'clearinghouse_portal_consent',current_date,'granted')`, [ORG, D6])) === null);
ok("…and restricted like every testing record, on both tables",
  (await one(`select count(*) filter (where qual like '%clearinghouse_portal_consent%') n from pg_policies
               where policyname in ('qualification_records_restricted_testing','documents_restricted_testing')`)).n == 2);
ok("a handbook filing for one invitation cannot be recorded twice (A-10)",
  await (async () => {
    const ins = `insert into qualification_records (org_id, driver_id, kind, occurred_on, result, detail)
                 values ($1,$2,'handbook',current_date,'signed',jsonb_build_object('source','handbook_signing','invitation_id',$3::text))`;
    await db.query(ins, [ORG, D6, I6]);
    return (await code(ins, [ORG, D6, I6])) === "23505";
  })());

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
