// FuelGuard — EFS card-control trigger behaviour matrix (Phase 5, migrations 0196 and 0197).
//
// WHY THIS FILE EXISTS. Steps 5.3 and 5.7 both moved a rule INTO the database, for the reason
// migration 0142 gave in almost these words: "an invariant enforced only by the one caller that
// remembers is not an invariant". `efs_soap_credentials` and `efs_card_mutations` are written by a
// service-role client that bypasses RLS, so Postgres is the only place those rules cannot be
// forgotten by a future writer.
//
// A rule in a trigger that nothing exercises is worse than one in the service, though: it is
// invisible until it fires in production, and 0197 nearly shipped scoped so tightly that it would
// have wedged cards permanently (see the third describe below). The unit suites cannot reach it —
// they run against a Supabase fake — so it is proven here, in PGlite, against the FULL production
// migration ledger applied verbatim.
//
// This also means `require-ci-green` gates `migrate.yml` on these assertions: the migrations cannot
// reach the real Supabase project unless the behaviour they encode is proven on that commit.
//
// Run:  node supabase/tests/efs-card-control-triggers.test.mjs
// Requires: pnpm add -w @electric-sql/pglite
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SUPA = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(SUPA, f), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations")).filter((f) => f.endsWith(".sql")).sort();

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
/** Run a statement and return its error message, or null when it succeeded. */
const err = async (p) => { try { await p; return null; } catch (e) { return e.message; } };

// Supabase-managed objects (present in a real project; shimmed here). Kept in step with the shim in
// rls.test.mjs — a migration that starts writing a new column here fails to apply otherwise.
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
  grant usage on schema public, storage to anon, authenticated, service_role;
`);

console.log(`Applying ${MIGRATIONS.length} migrations in lexical order`);
for (const name of MIGRATIONS) {
  await db.exec(read(`migrations/${name}`).replace(/create extension if not exists pgcrypto;?/gi, ""));
}
await db.exec("grant all on all tables in schema storage to anon, authenticated, service_role;");

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────────
const ORG = (await one(
  `insert into organizations (id, name) values (gen_random_uuid(), 'Trigger Matrix Co') returning id`,
)).id;
const MAKER = (await one(`insert into auth.users (id, email) values (gen_random_uuid(), 'maker@x.test') returning id`)).id;
const CHECKER = (await one(`insert into auth.users (id, email) values (gen_random_uuid(), 'checker@x.test') returning id`)).id;

console.log("\n-- 0196: efs_soap_credentials.updated_at is a CONFIGURATION timestamp --");

await db.query(
  `insert into efs_soap_credentials (org_id, environment, endpoint_url, soap_username, soap_password, account_id)
   values ($1, 'sandbox', 'https://qa.efsllc.com/axis2/services/CardManagementWS/', 'user', 'pass', 'ACC-1')`,
  [ORG],
);
/**
 * A PLANTED SENTINEL, not a comparison of two clock readings.
 *
 * ── Why comparing timestamps cannot work here, measured rather than argued ───────────────────────
 * This matrix runs on PGlite, whose clock has MILLISECOND resolution: `to_char(now(), '…US')` always
 * renders `000` in the microsecond field, and eight consecutive transactions produce about three
 * distinct values. So two updates that land inside the same millisecond read back identical no
 * matter what the trigger did, and `after !== before` fails on a trigger that fired correctly.
 *
 * That is not hypothetical. On a fast machine all three "DOES move" assertions failed intermittently
 * — five runs out of five had at least one red — while the same commit passed on CI, whose slower
 * runners cross a millisecond boundary more often. A gate that grades the hardware is not a gate.
 *
 * ── This was previously mistaken for a precision problem, twice ──────────────────────────────────
 * The first version compared `String(updated_at)`, which renders at SECOND resolution. The fix moved
 * to microsecond text — but PGlite never had microseconds to give, so it shrank the flake window
 * from a second to a millisecond instead of closing it.
 *
 * ── What the sentinel fixes that precision never could, mutated rather than argued ───────────────
 * Restoring the Step 5.7 defect itself — `new.updated_at = now()` unconditionally — against the OLD
 * clock-comparison test scored 4, 4 and 5 failures on three consecutive runs: a DIFFERENT set each
 * time, including "a password rotation DOES move updated_at", which that mutation cannot break, and
 * including genuine false passes where a "does not move" case went green against a trigger bumping
 * every write. The signal and the noise were indistinguishable.
 *
 * Against the sentinel the same mutation scores exactly 3, every run — the three negative cases, the
 * ones it actually breaks. Freezing the column instead (`new.updated_at = old.updated_at` in both
 * branches) scores exactly the other 3. Planting the year 2000 first means only the trigger's `else`
 * branch can leave it there, so the negative cases finally carry a positive control.
 */
const SENTINEL_TS = "2000-01-01 00:00:00.000000";

const credUpdatedAt = async () =>
  (await one(
    `select to_char(updated_at, 'YYYY-MM-DD HH24:MI:SS.US') as ts from efs_soap_credentials where org_id=$1`,
    [ORG],
  )).ts;

/**
 * The trigger DISCARDS a write that touches `updated_at` alone — that is the no-op rule asserted at
 * the bottom of this block — so the sentinel cannot be planted through it. Disabling the trigger for
 * the one statement that plants it is the only way in, and it is also the honest one: the sentinel is
 * setup, not a behaviour under test.
 */
const plantSentinel = async () => {
  await db.query(`alter table efs_soap_credentials disable trigger trg_efs_soap_credentials_updated`);
  await db.query(`update efs_soap_credentials set updated_at = $2 where org_id = $1`, [ORG, SENTINEL_TS]);
  await db.query(`alter table efs_soap_credentials enable trigger trg_efs_soap_credentials_updated`);
  if ((await credUpdatedAt()) !== SENTINEL_TS) throw new Error("sentinel did not plant — setup is broken");
};

const sentinelIntact = async () => (await credUpdatedAt()) === SENTINEL_TS;

{
  // The whole point of Step 5.7. Every poll used to bump this column, so it could not answer "when
  // was this credential last CHANGED" — the question asked after a security incident — because a
  // poller overwrote the answer within the hour.
  await plantSentinel();
  await db.query(
    `update efs_soap_credentials
        set posted_last_polled_at = now(), posted_last_success_at = now(),
            posted_last_cursor = '2026-08-16T00:00:00Z', posted_last_error = null
      where org_id = $1`,
    [ORG],
  );
  ok("a successful poll does not move updated_at", await sentinelIntact());
}

{
  await plantSentinel();
  await db.query(
    `update efs_soap_credentials set rejected_last_polled_at = now(), rejected_last_error = 'socket closed' where org_id=$1`,
    [ORG],
  );
  ok("a failed poll does not move updated_at", await sentinelIntact());
}

{
  // The other half. If this regressed, the column would be frozen forever and the "fix" would have
  // destroyed the answer in the opposite direction — which is why it is asserted, not assumed.
  await plantSentinel();
  await db.query(`update efs_soap_credentials set soap_password = 'rotated' where org_id=$1`, [ORG]);
  ok("a password rotation DOES move updated_at", !(await sentinelIntact()));
}

{
  await plantSentinel();
  await db.query(`update efs_soap_credentials set endpoint_url = endpoint_url || '?v=2' where org_id=$1`, [ORG]);
  ok("repointing the endpoint DOES move updated_at", !(await sentinelIntact()));
}

{
  await plantSentinel();
  await db.query(`update efs_soap_credentials set enabled = not enabled where org_id=$1`, [ORG]);
  ok("flipping the kill switch DOES move updated_at", !(await sentinelIntact()));
}

{
  // A write that changes nothing is not a configuration change. Without this the trigger would move
  // the column on any no-op UPDATE, which is how a poller that writes an unchanged cursor would
  // quietly reintroduce the whole defect.
  await plantSentinel();
  await db.query(`update efs_soap_credentials set account_id = account_id where org_id=$1`, [ORG]);
  ok("a no-op write moves nothing", await sentinelIntact());
}

console.log("\n-- 0197: a mutation that reached the vendor records who approved it --");

const CARD = (await one(
  `insert into efs_cards (org_id, card_ref_hmac, card_number_sealed, card_last4, status, document, card_version)
   values ($1, 'hmac-1', 'sealed-1', '7671', 'Active', '{}'::jsonb, 'v1') returning id`,
  [ORG],
)).id;

/** Open a fresh `pending` mutation, as `insertPending` does — deliberately with no approver. */
async function openPending() {
  // One-in-flight is enforced by a unique index, so each case settles its own row first.
  await db.query(`delete from efs_card_mutations where org_id=$1`, [ORG]);
  return (await one(
    `insert into efs_card_mutations (org_id, efs_card_id, intent, status, reason, requested_by)
     values ($1, $2, 'lock', 'pending', 'Truck broken into overnight', $3) returning id`,
    [ORG, CARD, MAKER],
  )).id;
}

{
  const id = await openPending();
  ok("a row may be OPENED pending with no approver — that is the maker's half",
    (await one(`select approved_by from efs_card_mutations where id=$1`, [id])).approved_by === null);
}

for (const status of ["sent", "succeeded", "drift_detected", "partial"]) {
  const id = await openPending();
  const message = await err(db.query(`update efs_card_mutations set status=$2 where id=$1`, [id, status]));
  ok(`'${status}' is REFUSED without an approver — the write reached EFS`,
    message !== null && /must record who approved it/.test(message), message ?? "no error raised");
}

{
  const id = await openPending();
  const message = await err(db.query(
    `update efs_card_mutations set status='sent', approved_by=$2 where id=$1`, [id, CHECKER]));
  ok("'sent' is ALLOWED once the approver is stamped", message === null, message ?? "");
  ok("and the approver is what markSent wrote, not the requester",
    (await one(`select approved_by from efs_card_mutations where id=$1`, [id])).approved_by === CHECKER);
}

{
  // Today plan and apply are one request, so the approver IS the requester. Migration 0142 takes the
  // same position for loads: a recorded self-approval is a legitimate outcome, and a null would lose
  // the fact that anyone authorised it at all.
  const id = await openPending();
  const message = await err(db.query(
    `update efs_card_mutations set status='succeeded', approved_by=$2 where id=$1`, [id, MAKER]));
  ok("a recorded SELF-approval is accepted — two people are Phase C, not today", message === null, message ?? "");
}

{
  // THE NEAR-MISS THIS MATRIX EXISTS FOR.
  //
  // 0197's first draft forbade ANY row leaving `pending` without an approver.
  // `services/efsCardUnresolved.ts` condemns ABANDONED rows — a pending mutation whose process died
  // before `ledger.markSent` ever ran — straight to `failed`, and those have no approver because
  // nothing got far enough to record one. That draft would have raised here; and since
  // `uq_efs_card_mutations_one_pending` lets a stuck pending row block EVERY further mutation on
  // that card, refusing the recovery sweep would have wedged the card permanently. An audit control
  // turned into an outage.
  const id = await openPending();
  const message = await err(db.query(
    `update efs_card_mutations
        set status='failed', efs_fault_code='abandoned', completed_at=now()
      where id=$1`,
    [id],
  ));
  ok("the abandonment sweep can condemn a dead 'pending' row to 'failed' with NO approver",
    message === null, message ?? "");
}

{
  // …and the exemption is not a hole in the rule. A failure that happened AFTER dispatch went
  // through markSent, so it still carries its approver — the constraint keeps its meaning.
  const id = await openPending();
  await db.query(`update efs_card_mutations set status='sent', approved_by=$2 where id=$1`, [id, CHECKER]);
  await db.query(`update efs_card_mutations set status='failed' where id=$1`, [id]);
  ok("a real post-dispatch failure still carries the approver it was stamped with",
    (await one(`select approved_by from efs_card_mutations where id=$1`, [id])).approved_by === CHECKER);
}

{
  // History is left alone on purpose: back-filling rows written before anything stamped the column
  // would manufacture approvals that never happened. The trigger fires on UPDATE only, so a legacy
  // row can still be read and can still be settled through the abandonment path.
  await db.query(`delete from efs_card_mutations where org_id=$1`, [ORG]);
  const legacy = (await one(
    `insert into efs_card_mutations (org_id, efs_card_id, intent, status, reason, requested_by)
     values ($1, $2, 'lock', 'succeeded', 'historical row, pre-0197', $3) returning id`,
    [ORG, CARD, MAKER],
  )).id;
  ok("an INSERT of a historical settled row is not rejected — no retroactive approvals invented",
    (await one(`select approved_by from efs_card_mutations where id=$1`, [legacy])).approved_by === null);
}

console.log("\n-- 0200: the account's prompt vocabulary, and the two things it may not be --");

/**
 * Asserted by inserting what the constraints must REJECT, never by reading them.
 *
 * That is not ceremony. 0173's non-empty-scopes CHECK was written as
 * `array_length(scopes, 1) >= 1` and never held for a single day: `array_length('{}', 1)` is NULL,
 * `NULL >= 1` is NULL, and a CHECK rejects only on FALSE. It was found by running a later migration
 * against a scratch database and feeding it the row it was supposed to refuse (`docs/22` H15).
 * 0200's own non-empty rule uses `cardinality` for exactly that reason, so it is proven the same way.
 */
{
  await db.query(`insert into efs_card_control_settings (org_id) values ($1)
                  on conflict (org_id) do nothing`, [ORG]);

  const set = (types, at) => err(db.query(
    `update efs_card_control_settings set prompt_types = $2, prompt_types_at = $3 where org_id = $1`,
    [ORG, types, at],
  ));

  ok("a never-walked account is representable — both null",
    (await set(null, null)) === null);

  ok("a real vocabulary with its timestamp is accepted",
    (await set(["DRID", "UNIT", "ODRD"], new Date("2026-08-16T17:22:53Z").toISOString())) === null);

  ok("the stored vocabulary is the ACCOUNT's, not the editable subset",
    (await one(`select cardinality(prompt_types) n from efs_card_control_settings where org_id=$1`, [ORG])).n === 3);

  // The H15 case itself. `array_length('{}', 1)` would have let this through.
  ok("an EMPTY vocabulary is REFUSED — null and '{}' are not two ways to say the same thing",
    (await set([], new Date().toISOString())) !== null);

  ok("a vocabulary with no read date is REFUSED — the value without its provenance",
    (await set(["DRID"], null)) !== null);

  ok("a read date with no vocabulary is REFUSED — a timestamp about nothing",
    (await set(null, new Date().toISOString())) !== null);

  // A positive control on the four refusals above: they must be rejecting the SHAPE, not rejecting
  // every write. Without this, a constraint that refused everything would score four passes.
  ok("…and the row is still writable afterwards, so the refusals are about shape",
    (await set(["DRID", "UNIT"], new Date().toISOString())) === null);
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
