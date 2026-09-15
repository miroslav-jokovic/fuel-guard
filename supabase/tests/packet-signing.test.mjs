// Silvicom 360 — packet signing matrix (migrations 0339 and 0340, APPLICATION-PACKET-PLAN P5 /
// D-PKT6).
//
// The owner's flow ends with the driver being walked to every place the carrier's lawyers drew a
// line: *"the driver needs to be navigated precisely from place to place and sign all places."*
// `packetPlacements.ts` says there are twenty-two of those places and that six more on the same
// pages belong to the carrier or to a witness. This proves the database half of the walk:
//
//   · each stop becomes its own row, carrying the page, the line and the sentence as signed
//   · the count climbs one at a time, and only the LAST one reports the packet complete
//   · the same stop cannot be marked twice on one link, however many taps or tabs arrive
//   · nothing can be signed before the office approves, or after the application is filed —
//     the window D-AX11 opened when it split the signing (0336), because six of these stops are
//     certifications that the answers are true and the office may still be correcting them
//   · TWO adopted marks (D-PKT6): the first `signature` row fixes the signature and the first
//     `initials` row fixes the initials, each refusing a later stop of its own kind that disagrees —
//     and NEITHER refusing the other, which is the whole of 0340 (Q-PKT8)
//   · no phase column is stamped, because "complete" is a count against the TypeScript array
//
// Applies EVERY migration, same as rls.test.mjs.
//
// Run:  node supabase/tests/packet-signing.test.mjs
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
const count = async (q, p = []) => Number((await one(q, p)).n);
const raised = async (fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
};

// Supabase-managed schemas, shimmed identically to rls.test.mjs.
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create schema if not exists storage;
  create table storage.buckets (
    id text primary key,
    name text,
    public boolean default false,
    file_size_limit bigint,
    allowed_mime_types text[],
    owner uuid,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text, name text, owner uuid, created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text)
  returns text[]
  language sql
  immutable
  as $fn$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
  $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (
    version text primary key,
    name text,
    statements text[]
  );
  create role supabase_auth_admin nologin;
  create role authenticated nologin;
  create role anon nologin;
  create role service_role nologin bypassrls;
`);
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

// A brand new table has no grant for `authenticated` without this, so a read would ERROR rather than
// be filtered by policy — and "it threw" would look like "it was refused".
await db.exec(`
  grant usage on schema public to authenticated, anon;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant select on all tables in schema public to anon;
  alter default privileges in schema public grant select on tables to anon;
`);

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;
const DRIVER = (
  await one(`insert into drivers (org_id, full_name, status) values ($1,'Marija Varmeda','applicant') returning id`, [ORG])
).id;

const invite = async (label, expires = "now() + interval '14 days'") =>
  (
    await one(
      `insert into application_invitations (org_id, driver_id, token_hash, expires_at)
         values ($1, $2, $3, ${expires}) returning id`,
      [ORG, DRIVER, `hash-${label}`],
    )
  ).id;

const approve = (invitation) =>
  db.query(`update application_invitations set approved_at = now() where id = $1`, [invitation]);

// ⚠ The driver's twenty-two stops, in the packet's own page order — the same list and the same ids
// `driverPlacements()` produces, because the API passes this function what that array holds. Kept
// here as data rather than imported: a matrix runs against the migrations alone, and an .mjs test
// reaching into a built TypeScript package would make the database's behaviour depend on a build.
const STOPS = [
  ["p03", 3, "signature", "Date | Signature", "Orientation and the drug test it includes"],
  ["p04", 4, "signature", "Applicant's Signature | Date", "Permission to obtain background reports"],
  ["p05", 5, "initials", "Initials", "The minimum qualifications for the job"],
  ["p06", 6, "initials", "Initials", "The documents required, and the criminal-history rules"],
  ["p09", 9, "initials", "Initials", "Company rules and regulations, part three"],
  ["p10", 10, "signature", "Signature | Date", "Company rules and regulations, part four"],
  ["p11a", 11, "signature", "Date | Applicant signature", "Permission to ask previous employers about you"],
  ["p11b", 11, "signature", "Date | Applicant signature", "That everything on this application is true"],
  ["p13", 13, "signature", "Signature of applicant | Date", "That your answers are true, and this stays open for 45 days"],
  ["p15", 15, "signature", "Signature of applicant | Date | Sent to", "Release of your past employment and testing history"],
  ["p17", 17, "signature", "Signature of applicant | Date", "That this application is true, and that we may check your history"],
  ["p18", 18, "signature", "Driver signature: | Date:", "That the licence you gave us is the only one you hold"],
  ["p19a", 19, "signature", "Driver signature: | Date:", "Permission to check your driving record"],
  ["p19b", 19, "signature", "Driver signature: | Date:", "Permission to check your driving record"],
  ["p20", 20, "signature", "Driver signature: | Date:", "Consumer reports for employment purposes"],
  ["p22", 22, "signature", "Driver name Print | Driver signatrure", "Agreement to give a urine sample"],
  ["p25", 25, "signature", "Driver/Owner Signature", "Receipt of the driver handbooks"],
  ["p26", 26, "signature", "Driver/Owner Signature", "Your answer about any earlier failed or refused test"],
  ["p27", 27, "signature", "Signature", "Who may ride with you, and how off-duty time is logged"],
  ["p28", 28, "signature", "Signature", "The alcohol and drug abuse policy"],
  ["p31a", 31, "signature", "Signature | Date", "The owner-operator and leased-driver agreement, as the driver"],
  ["p31b", 31, "signature", "Signature | Date", "The owner-operator and leased-driver agreement, as the owner-operator"],
];

// ⚠ The driver adopts TWO marks, not one (D-PKT6), and which one a stop takes is the stop's own
// `mark` kind — never anything derived from the other. `MV` is not an abbreviation the ceremony
// computed; it is a second thing the driver typed.
const SIGNATURE = "Marija Varmeda";
const INITIALS = "MV";
const markFor = (stop) => (stop[2] === "initials" ? INITIALS : SIGNATURE);

const mark = (invitation, stop, name = markFor(stop), expected = STOPS.length) =>
  db.query(
    `select public.record_packet_mark($1,$2,$3,$4,$5,$6,$7,$8,'203.0.113.9','UA',$9) as r`,
    [ORG, invitation, stop[0], stop[1], stop[2], stop[3], stop[4], name, expected],
  );

// ── the inventory this matrix walks is the one the ceremony walks ──────────────────────────────
// Guards the guard. Every assertion below is over STOPS, so a list that had drifted from
// `packetPlacements.ts` would make all of them vacuously agreeable.
ok("twenty-two stops, which is what the inventory says are the driver's", STOPS.length === 22);
ok("across nineteen pages", new Set(STOPS.map((s) => s[1])).size === 19);
ok("with three of them taking initials rather than a signature", STOPS.filter((s) => s[2] === "initials").length === 3);
ok("and every id distinct, which is the only thing telling page 19's two lines apart", new Set(STOPS.map((s) => s[0])).size === 22);

// ── nothing is signable until the office has approved ──────────────────────────────────────────
const EARLY = await invite("early");
const tooSoon = await raised(() => mark(EARLY, STOPS[0]));
ok("an unapproved packet refuses every stop (DR032)", tooSoon?.code === "DR032", String(tooSoon?.code));
ok("and nothing was written", (await count(`select count(*)::int as n from application_packet_marks where invitation_id = $1`, [EARLY])) === 0);

// ── the walk itself ────────────────────────────────────────────────────────────────────────────
// ⚠ This loop is itself the regression test for Q-PKT8. It sends the initials at p05, the fifth
// stop, having sent the signature at the four before it — and under 0339's pin that raised DR035 and
// threw out of the matrix here. Twenty-two stops completing in one pass is 0340's whole claim.
const INV = await invite("marija");
await approve(INV);
const results = [];
for (const stop of STOPS) results.push((await mark(INV, stop)).rows[0].r);

ok("each stop becomes its own row", (await count(`select count(*)::int as n from application_packet_marks where invitation_id = $1`, [INV])) === 22);
ok("the count climbs one at a time", results.map((r) => r.signed_count).join(",") === STOPS.map((_, i) => i + 1).join(","));
ok(
  "only the last one reports the packet complete",
  results.slice(0, 21).every((r) => r.complete === false) && results[21].complete === true,
);

// ⚠ No phase column. "Complete" is a count against the array, computed where it is asked for, so
// there is no second place the number twenty-two lives (see 0339's header).
const cols = await db.query(
  `select column_name from information_schema.columns
    where table_name = 'application_invitations' and column_name like 'packet%'`,
);
ok("and stamps no phase column, because the count is the phase", cols.rows.length === 0);

// §390.32(d): the row reproduces what was signed without loading today's constant.
const rows = (await db.query(
  `select placement_id, page, mark, anchor, affirmed, signed_name, host(signed_ip) as ip, signed_user_agent
     from application_packet_marks where invitation_id = $1 order by page, placement_id`,
  [INV],
)).rows;
ok("each row keeps the page it was signed on", rows.map((r) => r.page).join(",") === STOPS.map((s) => s[1]).sort((a, b) => a - b).join(","));
ok("and the line on it, including the carrier's own spelling of `signatrure`", rows.some((r) => r.anchor === "Driver name Print | Driver signatrure"));
ok("and the sentence the driver was shown", new Set(rows.map((r) => r.affirmed)).size === 21, "page 19's two lines say the same thing");
// ⚠ `host()` rather than `::text`: PGlite renders an inet cast to text as `203.0.113.9/32` and
// Postgres renders it `203.0.113.9`, so the cast would assert a difference between the two
// engines rather than anything about the signature.
ok("with the attribution every signature in this product carries", rows.every((r) => r.ip === "203.0.113.9" && r.signed_user_agent === "UA"));
// ⚠ TWO adopted marks, applied by kind — and the three that take initials are the three narrowest
// lines in the packet (89–141pt), which is where a full name drawn by the overlay had nowhere to go.
ok(
  "every signature line carries the adopted signature",
  rows.filter((r) => r.mark === "signature").every((r) => r.signed_name === SIGNATURE),
);
ok(
  "and every initials line the adopted initials, which are not derived from it",
  rows.filter((r) => r.mark === "initials").length === 3
    && rows.filter((r) => r.mark === "initials").every((r) => r.signed_name === INITIALS),
);
ok("so the packet carries exactly two marks, not one and not twenty-two", new Set(rows.map((r) => r.signed_name)).size === 2);

// ⚠ Page 19's two stops are identical in every field but the id, because the carrier's page really
// does carry its heading and its signature line twice. Nothing else could tell them apart.
const p19 = rows.filter((r) => r.page === 19);
ok("page 19 holds two marks that differ only by id", p19.length === 2 && p19[0].anchor === p19[1].anchor && p19[0].affirmed === p19[1].affirmed);

// ── no control can produce a stop twice ────────────────────────────────────────────────────────
const twice = await raised(() => mark(INV, STOPS[0]));
ok("the same stop cannot be marked twice on one link (DR034)", twice?.code === "DR034", String(twice?.code));
ok("and nothing was added", (await count(`select count(*)::int as n from application_packet_marks where invitation_id = $1`, [INV])) === 22);

// ── two adopted marks, each enforced where a second tab meets it ───────────────────────────────
// ⚠ The pin is per (invitation, mark kind) since 0340. Both halves matter and they pull opposite
// ways: it must still refuse a second SIGNATURE as hard as 0339 did, and it must stop reading the
// driver's initials as one.
const PAIR = await invite("pair");
await approve(PAIR);
await mark(PAIR, STOPS[0]);
const renamed = await raised(() => mark(PAIR, STOPS[1], "M. Varmeda"));
ok("a second signature on the same packet is refused (DR035)", renamed?.code === "DR035", String(renamed?.code));
ok("leaving the first mark alone", (await count(`select count(*)::int as n from application_packet_marks where invitation_id = $1`, [PAIR])) === 1);
const sameName = await raised(() => mark(PAIR, STOPS[1]));
ok("while the adopted signature carries on being accepted", sameName === null, String(sameName?.code));

// ⚠ Q-PKT8, at the stop that used to fail: p05 takes initials, and they differ from the signature
// pinned two stops ago by every character. 0339 raised DR035 here.
ok("the stop below is the initials one it claims to be", STOPS[2][0] === "p05" && STOPS[2][2] === "initials");
const firstInitials = await raised(() => mark(PAIR, STOPS[2]));
ok("initials are NOT read as a second signature (Q-PKT8)", firstInitials === null, String(firstInitials?.code));
ok(
  "and they are filed as themselves rather than as the name",
  (await one(`select signed_name from application_packet_marks where invitation_id = $1 and placement_id = 'p05'`, [PAIR])).signed_name === INITIALS,
);

// ...and the initials are adopted ONCE in their own right, which is the half that would be lost by
// simply dropping DR035.
const reinitialled = await raised(() => mark(PAIR, STOPS[3], "MJV"));
ok("a second set of initials on the same packet is refused (DR035)", reinitialled?.code === "DR035", String(reinitialled?.code));
const sameInitials = await raised(() => mark(PAIR, STOPS[3]));
ok("while the adopted initials carry on being accepted", sameInitials === null, String(sameInitials?.code));
ok(
  "so the link holds one signature and one set of initials, and no third mark",
  (await count(
    `select count(distinct signed_name)::int as n from application_packet_marks where invitation_id = $1`,
    [PAIR],
  )) === 2,
);

// ── and nothing is signable once the application is filed ──────────────────────────────────────
const FILED = await invite("filed");
await approve(FILED);
await mark(FILED, STOPS[0]);
await db.query(`update application_invitations set submitted_at = now() where id = $1`, [FILED]);
const afterwards = await raised(() => mark(FILED, STOPS[1]));
ok("a filed application refuses another mark (DR033)", afterwards?.code === "DR033", String(afterwards?.code));

// ── the invitation still governs the whole session ─────────────────────────────────────────────
const REVOKED = await invite("revoked");
await approve(REVOKED);
await db.query(`update application_invitations set revoked_at = now() where id = $1`, [REVOKED]);
const revoked = await raised(() => mark(REVOKED, STOPS[0]));
ok("a revoked invitation cannot be signed on (DR031)", revoked?.code === "DR031", String(revoked?.code));

const EXPIRED = await invite("expired", "now() - interval '1 day'");
await approve(EXPIRED);
const expired = await raised(() => mark(EXPIRED, STOPS[0]));
ok("nor an expired one (DR031)", expired?.code === "DR031", String(expired?.code));

const missing = await raised(() => mark("00000000-0000-0000-0000-000000000000", STOPS[0]));
ok("nor one that does not exist (DR030)", missing?.code === "DR030", String(missing?.code));

// ── a rehire signs their own packet, not the one they signed last time ─────────────────────────
// Keyed on the invitation, never on the driver: the unique index is per link, and the packet a
// driver signed a year ago is not the packet in front of them now.
const RESCREEN = await invite("rescreen");
await approve(RESCREEN);
const again = await raised(() => mark(RESCREEN, STOPS[0]));
ok("the same stop can be marked again on a NEW link", again === null, String(again?.code));

// ── evidence, so it is append-only and it outlives nothing ─────────────────────────────────────
ok(
  "the table carries no update or delete policy",
  (await count(
    `select count(*)::int as n from pg_policies
      where tablename = 'application_packet_marks' and cmd in ('UPDATE','DELETE')`,
  )) === 0,
);
ok(
  "and no select policy either, so a browser is denied outright",
  (await count(`select count(*)::int as n from pg_policies where tablename = 'application_packet_marks'`)) === 0,
);
ok(
  "row level security is on",
  (await one(`select relrowsecurity as on from pg_class where relname = 'application_packet_marks'`)).on === true,
);
ok(
  "the signing function is service_role only",
  (await count(
    `select count(*)::int as n from information_schema.role_routine_grants
      where routine_name = 'record_packet_mark' and grantee in ('anon','authenticated','PUBLIC')`,
  )) === 0,
);

// ⚠ Deleting the invitation DOES take the marks: unlike a `driver_authorizations` row, a packet mark
// has no meaning without the packet it was made on — it is a place on a document, and the document
// is the session. 0234 is where the recruiting evidence that must survive a merge lives.
const DOOMED = await invite("doomed");
await approve(DOOMED);
await mark(DOOMED, STOPS[0]);
await db.query(`delete from application_invitations where id = $1`, [DOOMED]);
ok(
  "a mark goes with the invitation it was made on",
  (await count(`select count(*)::int as n from application_packet_marks where invitation_id = $1`, [DOOMED])) === 0,
);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
