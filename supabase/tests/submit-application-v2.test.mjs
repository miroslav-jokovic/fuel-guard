// Silvicom 360 — filing after Part 1 (migration 0376, APPLICATION-FLOW-V2-PLAN.md §8.2, D-AW4/D-AW8).
//
// The 13-argument `submit_driver_application` differs from 0231's in two ways that each have a case:
//   · a capture already promoted at Part 1 (`promoted_document_id`) is skipped, where 0231's body would
//     insert `documents.id = capture.id` a second time and die on the primary key — and the selfie is
//     never filed at all;
//   · every uncopied phone verification (`employer_verification_calls`) whose employer key matches a
//     filed employer becomes an `employer_inquiries` row (method phone, `phone-call-v1`, the wording
//     from `p_call_summaries`), and the call records which inquiry it became. A call with no summary
//     refuses the whole filing (DA043) rather than inventing §391.23 wording.
// Plus `employer_verification_calls`' own guard (EV010) and the overload rules of §8.1.
//
// Run:  node supabase/tests/submit-application-v2.test.mjs
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
    name text, owner uuid, created_at timestamptz default now());
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
const OFFICE = (await one(`insert into auth.users (id, email) values (gen_random_uuid(), 'office@example.com') returning id`)).id;
const driver = async () =>
  (await one(`insert into drivers (org_id, full_name, status) values ($1, 'Applicant', 'applicant') returning id`, [ORG])).id;
const invite = async (drv) =>
  (await one(`insert into application_invitations (org_id, driver_id, token_hash, expires_at)
              values ($1, $2, md5(random()::text), now() + interval '14 days') returning id`, [ORG, drv])).id;
const stage = async (inv, drv, slot) =>
  (await one(`select (public.stage_application_capture($1,$2,$3,gen_random_uuid(),$4,$5,'image/jpeg',100,'ab') ->> 'capture_id')::uuid id`,
    [ORG, inv, drv, slot, `${ORG}/${inv}/${slot}.jpg`])).id;
const capRow = (id, drv, kind, page = 1) => ({ capture_id: id, kind, page, storage_path: `${ORG}/driver/${drv}/${id}.jpg` });

const OUTCOMES = { dates: "confirmed", position: "corrected", reason: "confirmed", cmv: "confirmed", dot_tested: "not_confirmed" };
const call = async (inv, key, name, at = "now() - interval '2 days'") =>
  (await one(`insert into employer_verification_calls
                (org_id, invitation_id, employer_key, employer_name, outcomes, corrections, called_by, answered_by, called_at)
              values ($1, $2, $3, $4, $5::jsonb, '{"position":"Yard driver"}'::jsonb, $6, 'Dana, safety desk', ${at})
              returning id`, [ORG, inv, key, name, JSON.stringify(OUTCOMES), OFFICE])).id;

const employer = (key, name, dot = true) => ({
  key, employer_name: name, employer_address_line1: "1 Depot Rd", employer_city: "Joliet", employer_state: "IL",
  position_held: "Driver", started_on: "2020-01-01", ended_on: "2023-06-30", dot_regulated: dot, operated_cmv: true,
  subject_to_fmcsr: true, safety_sensitive: true, reason_for_leaving: "Relocated",
});

const submit13 = (inv, drv, employment, captures, summaries) =>
  db.query(`select public.submit_driver_application($1,$2,$3,'{"v":2}'::jsonb,'Applicant','203.0.113.9','UA','1234','sealed',
              '{"first_name":"A","last_name":"B"}'::jsonb,$4::jsonb,$5::jsonb,$6::jsonb) as r`,
    [ORG, inv, drv, JSON.stringify(employment), JSON.stringify(captures), summaries === null ? null : JSON.stringify(summaries)]);
const submitCode = async (...a) => { try { await submit13(...a); return null; } catch (e) { return e.code; } };

// ── Part 1 has run: CDL front/back promoted, the selfie staged but never filed ───────────────────
const D1 = await driver();
const I1 = await invite(D1);
await db.query(`select public.record_applicant_intake($1,$2,$3,$4::jsonb,null,null,false)`,
  [ORG, I1, D1, JSON.stringify({ prior_positive_2y: false, fcra_summary_version: "fcra-2023", medical_card_pending: true })]);
const front = await stage(I1, D1, "cdl_front");
const back = await stage(I1, D1, "cdl_back");
const selfie = await stage(I1, D1, "selfie");
await db.query(`select public.complete_applicant_intake($1,$2,$3,$4::jsonb)`,
  [ORG, I1, D1, JSON.stringify([capRow(front, D1, "cdl", 1), capRow(back, D1, "cdl", 2)])]);
ok("setup: Part 1 promoted the two CDL pages",
  (await count(`select count(*) n from application_captures where invitation_id=$1 and promoted_document_id is not null`, [I1])) === 2);
const medical = await stage(I1, D1, "medical_card");

// ── The office phoned two employers before filing; one of them twice ─────────────────────────────
const K1 = (await one(`select gen_random_uuid() id`)).id;
const K2 = (await one(`select gen_random_uuid() id`)).id;
const K3 = (await one(`select gen_random_uuid() id`)).id;
const c1a = await call(I1, K1, "Acme Freight", "now() - interval '3 days'");
const c1b = await call(I1, K1, "Acme Freight", "now() - interval '1 day'");
const c3 = await call(I1, K3, "Dropped Carrier");

const employment = [employer(K1, "Acme Freight"), employer(K2, "Never Called Ltd"), { ...employer(null, "No Key Co"), key: undefined }];
const allCaps = [capRow(front, D1, "cdl", 1), capRow(back, D1, "cdl", 2), capRow(medical, D1, "medical_card"), capRow(selfie, D1, "other")];

ok("DA043: a call that must be copied and has no summary refuses the filing",
  (await submitCode(I1, D1, employment, allCaps, { [c1a]: "Acme confirmed dates." })) === "DA043");
ok("…and the refused filing left nothing behind (one transaction)",
  (await one(`select submitted_at from application_invitations where id=$1`, [I1])).submitted_at === null &&
  (await count(`select count(*) n from employer_inquiries where driver_id=$1`, [D1])) === 0 &&
  (await count(`select count(*) n from driver_employment_history where driver_id=$1`, [D1])) === 0);

const r = (await submit13(I1, D1, employment, allCaps, {
  [c1a]: "Phoned Acme Freight: dates confirmed; position corrected to Yard driver.",
  [c1b]: "Phoned Acme Freight again: reason for leaving confirmed.",
})).rows[0].r;
ok("promoted captures are skipped: the filing does not collide on documents.id", !!r.application_id);
ok("…the Part 1 pages are filed exactly once",
  (await count(`select count(*) n from documents where id in ($1,$2)`, [front, back])) === 2);
ok("…the capture Part 1 had not promoted is filed now", (await count(`select count(*) n from documents where id=$1`, [medical])) === 1);
ok("…and the selfie is never filed, even when listed", (await count(`select count(*) n from documents where id=$1`, [selfie])) === 0);
ok("both calls under the filed employer's key were copied", r.calls_copied === 2);
const inq = (await db.query(
  `select i.method, i.wording_version, i.body_sent, i.sent_to, i.outcome, i.created_by, i.employment_id, i.response,
          e.employer_name
     from employer_inquiries i join driver_employment_history e on e.id = i.employment_id
    where i.driver_id = $1 order by i.contacted_on, i.body_sent`, [D1])).rows;
ok("each copy is a phone inquiry in the phone-call-v1 wording",
  inq.length === 2 && inq.every((x) => x.method === "phone" && x.wording_version === "phone-call-v1"));
ok("…against the new employment row matched by key", inq.every((x) => x.employer_name === "Acme Freight"));
ok("…with the summary as the wording, who answered, and who called",
  inq.some((x) => x.body_sent.startsWith("Phoned Acme Freight: dates")) &&
  inq.every((x) => x.sent_to === "Dana, safety desk" && x.created_by === OFFICE && x.outcome === "responded"));
ok("…and the call's outcomes carried in the response", inq.every((x) => x.response?.outcomes?.position === "corrected"));
const back1 = await db.query(`select id, copied_inquiry_id from employer_verification_calls where invitation_id=$1 order by called_at`, [I1]);
ok("each copied call names the inquiry it became",
  back1.rows.filter((x) => x.id !== c3).every((x) => x.copied_inquiry_id !== null));
ok("a call whose employer was not filed stays uncopied",
  back1.rows.find((x) => x.id === c3).copied_inquiry_id === null);
ok("the filing is otherwise 0231's: the application record and the certified record",
  (await count(`select count(*) n from qualification_records where driver_id=$1 and kind='employment_application'`, [D1])) === 1);

// ── EV010: append-only, one back-reference set once ──────────────────────────────────────────────
const inqId = back1.rows.find((x) => x.id === c1a).copied_inquiry_id;
ok("EV010: a call cannot be deleted", (await code(`delete from employer_verification_calls where id=$1`, [c1a])) === "EV010");
ok("EV010: its outcomes cannot be rewritten",
  (await code(`update employer_verification_calls set outcomes = outcomes || '{"cmv":"not_confirmed"}' where id=$1`, [c3])) === "EV010");
ok("EV010: a copied call's back-reference cannot be moved",
  (await code(`update employer_verification_calls set copied_inquiry_id = $2 where id=$1`, [c1b, inqId])) === "EV010");
ok("the one allowed update: an uncopied call's back-reference, once",
  (await code(`update employer_verification_calls set copied_inquiry_id = $2 where id=$1`, [c3, inqId])) === null);
ok("outcomes must name all five questions",
  (await code(`insert into employer_verification_calls (org_id, invitation_id, employer_key, employer_name, outcomes, called_by, answered_by, called_at)
               values ($1,$2,gen_random_uuid(),'X','{"dates":"confirmed"}'::jsonb,$3,'Y',now())`, [ORG, I1, OFFICE])) === "23514");
ok("…with only the three answers",
  (await code(`insert into employer_verification_calls (org_id, invitation_id, employer_key, employer_name, outcomes, called_by, answered_by, called_at)
               values ($1,$2,gen_random_uuid(),'X',$4::jsonb,$3,'Y',now())`,
    [ORG, I1, OFFICE, JSON.stringify({ ...OUTCOMES, cmv: "maybe" })])) === "23514");
ok("a JWT-bearing writer is refused (EV010)",
  await (async () => {
    try {
      await db.exec(`begin; select set_config('request.jwt.claims','{"role":"authenticated","user_role":"admin","org_id":"${ORG}"}',true);
        insert into employer_verification_calls (org_id, invitation_id, employer_key, employer_name, outcomes, called_by, answered_by, called_at)
        values ('${ORG}','${I1}',gen_random_uuid(),'X','${JSON.stringify(OUTCOMES)}'::jsonb,'${OFFICE}','Y',now()); commit;`);
      return false;
    } catch (e) { await db.exec("rollback"); return e.code === "EV010"; }
  })());

// ── The overloads ────────────────────────────────────────────────────────────────────────────────
const D2 = await driver();
const I2 = await invite(D2);
ok("the 12-argument function still files (positional, the served TypeScript's call)",
  (await code(`select public.submit_driver_application($1,$2,$3,'{}'::jsonb,'n','203.0.113.9','UA','1234','s','{}'::jsonb,'[]'::jsonb,'[]'::jsonb)`,
    [ORG, I2, D2])) === null);
const D3 = await driver();
const I3 = await invite(D3);
ok("the old key set (p_captures defaulted, as 0231 wrote it) resolves to exactly one function",
  (await code(`select public.submit_driver_application(p_org => $1, p_invitation => $2, p_driver => $3, p_payload => '{}'::jsonb,
     p_signed_name => 'n', p_ip => '203.0.113.9', p_user_agent => 'UA', p_ssn_last4 => '1234', p_ssn_sealed => 's',
     p_driver_patch => '{}'::jsonb, p_employment => '[]'::jsonb)`, [ORG, I3, D3])) === null);
const D4 = await driver();
const I4 = await invite(D4);
ok("the new key set resolves to exactly one function",
  (await code(`select public.submit_driver_application(p_org => $1, p_invitation => $2, p_driver => $3, p_payload => '{}'::jsonb,
     p_signed_name => 'n', p_ip => '203.0.113.9', p_user_agent => 'UA', p_ssn_last4 => '1234', p_ssn_sealed => 's',
     p_driver_patch => '{}'::jsonb, p_employment => '[]'::jsonb, p_captures => '[]'::jsonb, p_call_summaries => '{}'::jsonb)`,
    [ORG, I4, D4])) === null);
const SIG = "submit_driver_application(uuid,uuid,uuid,jsonb,text,text,text,text,text,jsonb,jsonb,jsonb,jsonb)";
const g = await one(`select has_function_privilege('anon', 'public.${SIG}', 'execute') a,
                            has_function_privilege('authenticated', 'public.${SIG}', 'execute') u,
                            has_function_privilege('service_role', 'public.${SIG}', 'execute') s,
                            (select pronargdefaults from pg_proc where oid = 'public.${SIG}'::regprocedure) d`);
ok("the new signature: anon and authenticated cannot execute, service_role can", !g.a && !g.u && g.s);
ok("the new signature: no parameter has a default", g.d === 0);
ok("the old signature is kept for the deploy window (dropped in M2)",
  (await count(`select count(*) n from pg_proc where proname = 'submit_driver_application' and pronamespace = 'public'::regnamespace`)) === 2);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
