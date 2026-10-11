// Silvicom 360 — adopted signatures and the versioned packet mark (migration 0376,
// APPLICATION-FLOW-V2-PLAN.md §8.2, D-AW15 and A-5).
//
// Four properties, each a section below:
//   1. `signature_adoptions` is append-only (SA010), with at most one LIVE adoption per (invitation,
//      kind); a new adoption supersedes the old in the same transaction, and the old row stays.
//   2. The 13-argument `record_packet_mark` refuses DR037 when the packet's text changed between two
//      marks on one link, and DR038 when the adoption it names is not a live adoption of this
//      invitation of this kind of mark — and records both columns when it accepts.
//   3. The 12-argument `record_driver_release` refuses DR038 unless the adoption is a live SIGNATURE.
//   4. The overloads: old-key and new-key calls each resolve to exactly one function, no new
//      parameter has a default (PGRST203, 0258/0312), and neither anon nor authenticated can execute
//      any new signature.
//
// Run:  node supabase/tests/signature-adoption.test.mjs
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
const driver = async (org = ORG) =>
  (await one(`insert into drivers (org_id, full_name, status) values ($1, 'Marija Varmeda', 'applicant') returning id`, [org])).id;
const invite = async (drv, org = ORG, expires = "now() + interval '14 days'") =>
  (await one(`insert into application_invitations (org_id, driver_id, token_hash, expires_at)
              values ($1, $2, md5(random()::text), ${expires}) returning id`, [org, drv])).id;
const approveAndOpen = async (inv) => {
  await db.query(`update application_invitations set approved_at = now() where id = $1`, [inv]);
  await db.query(`select public.open_packet_signing($1,$2,$3,14)`, [ORG, inv, `sign-${inv}`]);
};

const HASH = "b".repeat(64);
const pathFor = (org, drv, id) => `${org}/driver/${drv}/${id}.png`;
const newId = async () => (await one(`select gen_random_uuid() id`)).id;
const adopt = async (inv, drv, kind, typed = "Marija Varmeda", { org = ORG, id = null, path = null } = {}) => {
  const a = id ?? (await newId());
  const r = await db.query(
    `select public.record_signature_adoption($1,$2,$3,$4,$5,$6,$7,'203.0.113.9','UA') as r`,
    [org, inv, a, kind, typed, path ?? pathFor(ORG, drv, a), HASH]);
  return { id: a, r: r.rows[0].r };
};
const adoptCode = async (...a) => { try { await adopt(...a); return null; } catch (e) { return e.code; } };

// ── 1. signature_adoptions ───────────────────────────────────────────────────────────────────────
const D1 = await driver();
const I1 = await invite(D1);
const sig1 = await adopt(I1, D1, "signature");
ok("an adoption is recorded, superseding nothing", sig1.r.adoption_id === sig1.id && sig1.r.superseded_id === null);
const ini1 = await adopt(I1, D1, "initials", "MV");
ok("initials are their own kind and do not supersede the signature",
  ini1.r.superseded_id === null &&
  (await count(`select count(*) n from signature_adoptions where invitation_id=$1 and superseded_by is null`, [I1])) === 2);
const sig2 = await adopt(I1, D1, "signature", "Marija V.");
ok("a second signature supersedes the first in the same call", sig2.r.superseded_id === sig1.id);
ok("…the old row stays, pointing at its replacement",
  (await one(`select superseded_by, typed_text from signature_adoptions where id=$1`, [sig1.id])).superseded_by === sig2.id);
ok("one live adoption per (invitation, kind)",
  (await count(`select count(*) n from signature_adoptions where invitation_id=$1 and kind='signature' and superseded_by is null`, [I1])) === 1);
ok("a second LIVE row of a kind cannot be inserted around the writer (partial unique index)",
  (await code(`insert into signature_adoptions (id, org_id, invitation_id, kind, typed_text, storage_path, sha256)
                select x.id, $1::uuid, $2::uuid, 'signature', 'X', $1::text || '/driver/' || $3::text || '/' || x.id || '.png', $4
                  from (select gen_random_uuid() id) x`, [ORG, I1, D1, HASH])) === "23505");
ok("SA010: an adoption cannot be deleted",
  (await code(`delete from signature_adoptions where id=$1`, [sig1.id])) === "SA010");
ok("SA010: its typed text cannot be rewritten",
  (await code(`update signature_adoptions set typed_text = 'Forged' where id=$1`, [sig2.id])) === "SA010");
ok("SA010: a superseded adoption cannot be re-pointed",
  (await code(`update signature_adoptions set superseded_by = $2 where id=$1`, [sig1.id, ini1.id])) === "SA010");
ok("SA010: superseded_by cannot be cleared to resurrect an old adoption",
  (await code(`update signature_adoptions set superseded_by = null where id=$1`, [sig1.id])) === "SA010");
ok("SA020: an invitation of another org", (await adoptCode(I1, D1, "signature", "X", { org: OTHER })) === "SA020");
const DX = await driver();
const IX = await invite(DX, ORG, "now() - interval '1 day'");
ok("SA021: an expired link", (await adoptCode(IX, DX, "signature")) === "SA021");
const Dother = await driver();
ok("SA022: a storage key under another driver's folder",
  (await (async () => { const id = await newId(); return adoptCode(I1, D1, "signature", "X", { id, path: pathFor(ORG, Dother, id) }); })()) === "SA022");
ok("…and nothing was superseded by the refused call",
  (await count(`select count(*) n from signature_adoptions where invitation_id=$1 and kind='signature' and superseded_by is null`, [I1])) === 1 &&
  (await one(`select superseded_by from signature_adoptions where id=$1`, [sig2.id])).superseded_by === null);
ok("a kind outside signature/initials is refused by the CHECK", (await adoptCode(I1, D1, "stamp")) === "23514");
ok("a JWT-bearing writer is refused (SA010)",
  await (async () => {
    try {
      await db.exec(`begin; select set_config('request.jwt.claims','{"role":"authenticated","user_role":"admin","org_id":"${ORG}"}',true);
        insert into signature_adoptions (id, org_id, invitation_id, kind, typed_text, storage_path, sha256)
        select x.id, '${ORG}', '${I1}', 'initials', 'X', '${ORG}/driver/${D1}/' || x.id || '.png', '${HASH}'
          from (select gen_random_uuid() id) x; commit;`);
      return false;
    } catch (e) { await db.exec("rollback"); return e.code === "SA010"; }
  })());

// ── 2. record_packet_mark, 13 arguments ──────────────────────────────────────────────────────────
const mark13 = (inv, placement, page, kind, name, version, adoption, expected = 22) =>
  db.query(`select public.record_packet_mark($1,$2,$3,$4,$5,'Signature','I agree',$6,'203.0.113.9','UA',$7,$8,$9) as r`,
    [ORG, inv, placement, page, kind, name, expected, version, adoption]);
const markCode = async (fn) => { try { await fn(); return null; } catch (e) { return e.code; } };

await approveAndOpen(I1);
const m1 = (await mark13(I1, "p03", 3, "signature", "Marija V.", "pkt-v1", sig2.id)).rows[0].r;
ok("the 13-argument mark is accepted with a live signature adoption", !!m1.mark_id && m1.signed_count === 1);
ok("…and stores packet_version and adoption_id",
  await (async () => { const r = await one(`select packet_version, adoption_id from application_packet_marks where id=$1`, [m1.mark_id]);
    return r.packet_version === "pkt-v1" && r.adoption_id === sig2.id; })());
ok("DR037: a later mark against a different packet text",
  (await markCode(() => mark13(I1, "p10", 10, "signature", "Marija V.", "pkt-v2", sig2.id))) === "DR037");
ok("DR038: a superseded adoption", (await markCode(() => mark13(I1, "p10", 10, "signature", "Marija V.", "pkt-v1", sig1.id))) === "DR038");
ok("DR038: an adoption of the other kind (initials on a signature place)",
  (await markCode(() => mark13(I1, "p10", 10, "signature", "Marija V.", "pkt-v1", ini1.id))) === "DR038");
ok("DR038: an id that is no adoption at all",
  (await markCode(async () => mark13(I1, "p10", 10, "signature", "Marija V.", "pkt-v1", await newId()))) === "DR038");
const D2 = await driver();
const I2 = await invite(D2);
const sigOther = await adopt(I2, D2, "signature");
ok("DR038: another invitation's live adoption",
  (await markCode(() => mark13(I1, "p10", 10, "signature", "Marija V.", "pkt-v1", sigOther.id))) === "DR038");
ok("the initials adoption is accepted on an initials place",
  (await markCode(() => mark13(I1, "p05", 5, "initials", "MV", "pkt-v1", ini1.id))) === null);
ok("a null adoption is accepted (legacy marks print from the capture)",
  (await markCode(() => mark13(I1, "p06", 6, "initials", "MV", "pkt-v1", null))) === null);
ok("the 13-argument function keeps 0369's refusals (DR034, the same stop twice)",
  (await markCode(() => mark13(I1, "p03", 3, "signature", "Marija V.", "pkt-v1", sig2.id))) === "DR034");

// A-5 read: NULL is "the pre-versioning text" and does not refuse on its own.
await approveAndOpen(I2);
await mark13(I2, "p03", 3, "signature", "Marija Varmeda", null, null);
ok("a mark with no version (the pre-versioning text; M2b dropped the 11-argument function that made them) stores none",
  (await one(`select packet_version, adoption_id from application_packet_marks where invitation_id=$1`, [I2])).packet_version === null);
ok("a versioned mark after a pre-versioning one is not refused by DR037",
  (await markCode(() => mark13(I2, "p10", 10, "signature", "Marija Varmeda", "pkt-v1", sigOther.id))) === null);
ok("…but once a version is on the link, a different one is",
  (await markCode(() => mark13(I2, "p17", 17, "signature", "Marija Varmeda", "pkt-v9", null))) === "DR037");

// ── 3. record_driver_release, 12 arguments ───────────────────────────────────────────────────────
const release12 = (inv, drv, purpose, adoption, expected = 6) =>
  db.query(`select public.record_driver_release($1,$2,$3,$4,'v1',$5,'I authorize.','Marija V.','203.0.113.9','UA',$6,$7) as r`,
    [ORG, inv, drv, purpose, `Text for ${purpose}`, expected, adoption]);
const D3 = await driver();
const I3 = await invite(D3);
const sig3 = await adopt(I3, D3, "signature");
const ini3 = await adopt(I3, D3, "initials", "MV");
ok("DR038: a permission cannot take initials",
  (await markCode(() => release12(I3, D3, "psp", ini3.id))) === "DR038");
ok("DR038: nor another invitation's signature",
  (await markCode(() => release12(I3, D3, "psp", sig2.id))) === "DR038");
const rel = (await release12(I3, D3, "psp", sig3.id)).rows[0].r;
ok("a permission applying the live signature is recorded with its adoption",
  (await one(`select adoption_id, method from driver_authorizations where id=$1`, [rel.authorization_id])).adoption_id === sig3.id);
ok("the 12-argument function keeps 0228's refusals (DR023, the same instrument twice)",
  (await markCode(() => release12(I3, D3, "psp", sig3.id))) === "DR023");

// ── G-9: signed_on is for paper only ─────────────────────────────────────────────────────────────
ok("an esign permission cannot carry a paper signing day",
  (await code(`update driver_authorizations set signed_on = current_date where id=$1`, [rel.authorization_id])) !== null);

// ── 4. The overloads ─────────────────────────────────────────────────────────────────────────────
// PostgREST calls with NAMED arguments, so named notation is the resolution that matters: with no
// default on any new parameter, the old key set matches only the old function and the new key set
// only the new one. A defaulted p_adoption_id would make the old call match both (42725 here,
// PGRST203 through PostgREST).
const D4 = await driver();
const I4 = await invite(D4);
const sig4 = await adopt(I4, D4, "signature");
ok("record_driver_release: the old 11-argument key set resolves to nothing — M2b dropped it (42883)",
  (await code(`select public.record_driver_release(p_org => $1, p_invitation => $2, p_driver => $3, p_purpose => 'psp',
     p_version => 'v1', p_text => 't', p_intent => 'i', p_signed_name => 'n', p_ip => '203.0.113.9', p_user_agent => 'UA',
     p_expected_count => 6)`, [ORG, I4, D4])) === "42883");
ok("record_driver_release: the new key set resolves to exactly one function",
  (await code(`select public.record_driver_release(p_org => $1, p_invitation => $2, p_driver => $3, p_purpose => 'mvr',
     p_version => 'v1', p_text => 't', p_intent => 'i', p_signed_name => 'n', p_ip => '203.0.113.9', p_user_agent => 'UA',
     p_expected_count => 6, p_adoption_id => $4)`, [ORG, I4, D4, sig4.id])) === null);
await approveAndOpen(I4);
ok("record_packet_mark: the old 11-argument key set resolves to nothing — M2b dropped it (42883)",
  (await code(`select public.record_packet_mark(p_org => $1, p_invitation => $2, p_placement => 'p03', p_page => 3,
     p_mark => 'signature', p_anchor => 'a', p_affirmed => 'f', p_signed_name => 'n', p_ip => '203.0.113.9',
     p_user_agent => 'UA', p_expected_count => 22)`, [ORG, I4])) === "42883");
ok("record_packet_mark: the new key set resolves to exactly one function",
  (await code(`select public.record_packet_mark(p_org => $1, p_invitation => $2, p_placement => 'p10', p_page => 10,
     p_mark => 'signature', p_anchor => 'a', p_affirmed => 'f', p_signed_name => 'n', p_ip => '203.0.113.9',
     p_user_agent => 'UA', p_expected_count => 22, p_packet_version => 'pkt-v1', p_adoption_id => $3)`, [ORG, I4, sig4.id])) === null);

const NEW_SIGNATURES = [
  "record_packet_mark(uuid,uuid,text,int,text,text,text,text,text,text,int,text,uuid)",
  "record_driver_release(uuid,uuid,uuid,text,text,text,text,text,text,text,int,uuid)",
  "record_signature_adoption(uuid,uuid,uuid,text,text,text,text,text,text)",
];
for (const sig of NEW_SIGNATURES) {
  const name = sig.split("(")[0];
  const g = await one(`select has_function_privilege('anon', 'public.${sig}', 'execute') a,
                              has_function_privilege('authenticated', 'public.${sig}', 'execute') u,
                              has_function_privilege('service_role', 'public.${sig}', 'execute') s,
                              (select pronargdefaults from pg_proc where oid = 'public.${sig}'::regprocedure) d`);
  ok(`${name} (new signature): anon and authenticated cannot execute, service_role can`, !g.a && !g.u && g.s);
  ok(`${name} (new signature): no parameter has a default`, g.d === 0);
}
ok("the old signatures are gone (M2b): one function each",
  (await count(`select count(*) n from pg_proc where proname = 'record_packet_mark' and pronamespace = 'public'::regnamespace`)) === 1 &&
  (await count(`select count(*) n from pg_proc where proname = 'record_driver_release' and pronamespace = 'public'::regnamespace`)) === 1 &&
  (await count(`select count(*) n from pg_proc where proname = 'save_application_draft' and pronamespace = 'public'::regnamespace`)) === 1);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
