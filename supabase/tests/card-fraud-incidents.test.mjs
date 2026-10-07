// FuelGuard — card fraud incidents (migration 0438; CF2, D-CF1/D-CF2; F02-F04 PLAN.md chunk 5b).
//
// WHY THIS FILE EXISTS. Chunk 5a pinned the fold (`packages/shared/src/cardFraud.ts`) in unit tests;
// this pins where its incidents are stored. The unit suites run against a Supabase fake, so the
// one writer (`card_fraud_record`), its refusals and the delete guard are proven here, in PGlite,
// against the full migration ledger — driven by the REAL fold over production's declines, the way
// chunk 5c's scorers will drive it.
//
// What can be wrong, each asserted below:
//   • THE STORE DISAGREES WITH THE FOLD. Recording the 13 production attempts one at a time must leave
//     exactly what `foldFraudAttempts` makes of them in one pass: 7 incidents, 13 attempts, 8 steps.
//   • A RE-SCORE TELLS SOMEBODY TWICE. Recording the same attempts again must change nothing.
//   • TWO WORKERS SPLIT ONE EPISODE. A write based on a read the database has since moved past must be
//     refused, and the retry must join the incident the other worker opened.
//   • A PERSON'S CLOSE IS UNDONE. An attempt landing after a person closed the incident must open a new
//     one, never extend theirs.
//   • A VERDICT IS LOST. A reviewed incident must refuse DELETE; an untouched one and an org must not.
//   • THE BROWSER CAN REACH IT. RLS on, no policy, the writer closed to anon and authenticated.
//
// Run:  node supabase/tests/card-fraud-incidents.test.mjs   (after `pnpm --filter @silvicom/shared build:rn`)
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  applyFraudAttempt,
  cardFraudKey,
  classifyDeclineReason,
  failedPromptOf,
  foldFraudAttempts,
} from "../../packages/shared/dist/index.js";

const SUPA = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(SUPA, f), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations")).filter((f) => f.endsWith(".sql")).sort();

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
const count = async (q, p = []) => Number((await one(q, p)).n);
/** Run a statement and return its error message, or null when it succeeded. */
const err = async (p) => { try { await p; return null; } catch (e) { return e.message; } };
/** The writer's outcome, or the error it raised, so a broken writer reads as a FAIL, never a crash. */
const outcomeOf = async (p) => { try { return (await p)?.outcome ?? "no row"; } catch (e) { return `error: ${e.message}`; } };

// Supabase-managed objects (present in a real project; shimmed here), as in rls.test.mjs.
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
  grant usage on schema public, storage to anon, authenticated, service_role;
`);

ok("0438 present", MIGRATIONS.some((f) => f.startsWith("0438_card_fraud_incidents")));
console.log(`Applying ${MIGRATIONS.length} migrations in lexical order`);
for (const name of MIGRATIONS) {
  await db.exec(read(`migrations/${name}`).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────────
const ORG = (await one(`insert into organizations (name) values ('Card Fraud Co') returning id`)).id;
const OTHER = (await one(`insert into organizations (name) values ('Other Co') returning id`)).id;
const REVIEWER = (await one(`insert into auth.users (email) values ('reviewer@x.test') returning id`)).id;

// The 13 declines of 2026-09-02..10-02 that kept `location_mismatch`, and the four proximity declines
// a good fill followed, verbatim from production (read-only, 2026-10-07; the rows and query are in
// chunk 5a's test and PR #1346). [declined_at, card tail, unit, city, state, Samsara at station, EFS text]
const rows = [
  ["2026-09-07T09:18:00Z", "27975", "589", "AVOCA", "IA", true, "INVALID TRUCKSTOP IN0904907240|Merchant Position Too Far|"],
  ["2026-09-11T10:01:00Z", "07967", "555", "JACKSONVILLE", "FL", false, "INVALID TRUCKSTOP|Merchant Position Too Far|"],
  ["2026-09-11T10:01:00Z", "07967", "555", "JACKSONVILLE", "FL", false, "INVALID TRUCKSTOP|Failed restrictions|"],
  ["2026-09-11T21:04:00Z", "07967", "555", "JACKSONVILLE", "FL", false, "INACTIVE CARD|Non-Active Card|"],
  ["2026-09-12T12:57:00Z", "37550", "506", "VANDALIA", "IL", true, "INVALID TRUCKSTOP IN0524630858|Merchant Position Too Far|"],
  ["2026-09-22T13:13:00Z", "07977", "768", "BOWMAN", "SC", true, "INVALID TRUCKSTOP IN0894710933|Merchant Position Too Far|"],
  ["2026-09-22T16:48:00Z", "57972", "649", "CORBIN", "KY", true, "INVALID TRUCKSTOP IN0914018844|Merchant Position Too Far|"],
  ["2026-09-22T19:24:00Z", "27564", "729", "SOUTH BEND", "IN", false, "INVALID INFORMATION|ODOMETER|171662 IN0851404194||"],
  ["2026-09-22T19:24:00Z", "27564", "729", "SOUTH BEND", "IN", false, "INVALID INFORMATION|ODOMETER|171662 IN0851404457||"],
  ["2026-09-22T20:45:00Z", "77960", "739", "WAYLAND", "MO", false, "INACTIVE CARD IN0845001699|Non-Active Card|"],
  ["2026-09-23T00:16:00Z", "27564", "729", "SOUTH BEND", "IN", false, "INACTIVE CARD IN0851565240|Non-Active Card|"],
  ["2026-09-23T13:36:00Z", "87149", "735", "HARRISONBURG", "VA", false, "INACTIVE CARD|Non-Active Card|"],
  ["2026-09-26T03:47:00Z", "37977", "799", "FRANKLIN", "KY", false, "INVALID INFORMATION|DRIVER ID|ODOMETER IN0532460506||"],
  ["2026-09-26T03:47:00Z", "37977", "799", "FRANKLIN", "KY", false, "INVALID INFORMATION|DRIVER ID|ODOMETER IN0532460568||"],
  ["2026-09-26T22:42:00Z", "37977", "799", "FRANKLIN", "KY", false, "INACTIVE CARD IN0532837915|Non-Active Card|"],
  ["2026-09-27T12:46:00Z", "27564", "729", "SOUTH BEND", "IN", false, "INACTIVE CARD IN0854141423|Non-Active Card|"],
  ["2026-10-01T22:50:00Z", "07967", "555", "JACKSONVILLE", "FL", false, "INACTIVE CARD IN0535688009|Non-Active Card|"],
];
const vehicles = new Map();
for (const unit of new Set(rows.map((r) => r[2]))) {
  vehicles.set(unit, (await one(`insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1, $2, 150) returning id`, [ORG, unit])).id);
}
const attempts = [];
for (const [at, tail, unit, city, state, matched, desc] of rows) {
  const id = (await one(`select gen_random_uuid() id`)).id;
  attempts.push({
    id, source: "decline", at, cardRef: `70830500000003${tail}`, vehicleId: vehicles.get(unit), city, state,
    samsaraAtStation: matched, explainedByFill: false,
    reason: classifyDeclineReason(null, desc).category, failedPrompt: failedPromptOf(desc), truck: null,
  });
}
// Live scoring order: an import's rows in `declined_at` order.
attempts.sort((x, y) => x.at.localeCompare(y.at) || x.id.localeCompare(y.id));

// ── The scorer's loop, as chunk 5c will write it: read, fold one attempt, write, retry on refusal ──
const iso = (t) => new Date(t).toISOString();
const latestOf = (org, cardKey) =>
  one(`select * from card_fraud_incidents where org_id = $1 and card_key = $2 order by opened_at desc, created_at desc limit 1`, [org, cardKey]);
const asIncident = async (row) => row && ({
  key: row.incident_key, cardRef: row.card_ref, vehicleId: row.vehicle_id,
  openedAt: iso(row.opened_at), lastAttemptAt: iso(row.last_attempt_at), level: row.level,
  attemptIds: (await db.query(`select source_id from card_fraud_incident_attempts where incident_id = $1`, [row.id])).rows.map((r) => r.source_id),
  places: row.places, failedPrompts: row.failed_prompts, fuelTaken: row.fuel_taken, lastTruck: row.last_truck,
  steps: row.steps, closed: row.status === "resolved" || row.status === "dismissed",
});
const write = (org, a, latest, r) => one(
  `select * from card_fraud_record($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
  [
    org, cardFraudKey(a.cardRef, a.vehicleId), a.cardRef, latest?.id ?? null, latest?.version ?? null,
    latest && r.incident.key === latest.incident_key ? latest.id : null, r.incident.key, r.incident.vehicleId,
    r.incident.openedAt, r.incident.lastAttemptAt, r.incident.level, r.incident.attemptIds.length, r.incident.fuelTaken,
    JSON.stringify(r.incident.places), r.incident.failedPrompts, JSON.stringify(r.incident.steps),
    r.incident.lastTruck ? JSON.stringify(r.incident.lastTruck) : null, a.source, a.id, a.at, r.step,
  ],
);
/** Returns the outcomes seen, in order; `between` runs once, after the first read and before its write. */
async function record(org, a, between) {
  const seen = [];
  for (let i = 0; i < 3; i++) {
    const latest = await latestOf(org, cardFraudKey(a.cardRef, a.vehicleId));
    const cur = await asIncident(latest);
    const r = applyFraudAttempt(cur, a);
    if (!r.incident || r.incident === cur) return [...seen, "skipped"];
    if (between && i === 0) await between();
    const res = await outcomeOf(write(org, a, latest, r));
    seen.push(res);
    if (res !== "moved" && res !== "closed") return seen;
  }
  return seen;
}

// ── 1. The store equals the fold ────────────────────────────────────────────────────────────
const firstPass = [];
for (const a of attempts) firstPass.push((await record(ORG, a)).join(">"));
ok("the first pass records every qualifying attempt at the first try, and skips the four the fill explains",
  firstPass.filter((o) => o === "recorded").length === 13 && firstPass.filter((o) => o === "skipped").length === 4,
  firstPass.join(","));
const folded = foldFraudAttempts(attempts);
const stored = (await db.query(`select * from card_fraud_incidents where org_id = $1 order by opened_at, incident_key`, [ORG])).rows;
ok("the fold over production makes 7 incidents", folded.length === 7, String(folded.length));
ok("recording the attempts one by one stores the same 7", stored.length === 7, String(stored.length));
ok("13 attempts are stored, each in one incident",
  (await count(`select count(*) n from card_fraud_incident_attempts where org_id = $1`, [ORG])) === 13);
ok("the four proximity declines a fill followed are in none",
  (await count(`select count(*) n from card_fraud_incident_attempts where source_id = any($1::uuid[])`,
    [attempts.filter((a) => a.samsaraAtStation).map((a) => a.id)])) === 0);
// jsonb returns keys in its own order and timestamptz as a Date; compare values, in one canonical form.
const canon = (v) => Array.isArray(v) ? v.map(canon)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
const shape = (i) => JSON.stringify(canon([i.key, i.level, iso(i.openedAt), iso(i.lastAttemptAt), i.attemptIds.length, i.places, i.steps, i.failedPrompts, i.fuelTaken]));
const storedShapes = await Promise.all(stored.map(async (r) => shape(await asIncident(r))));
const foldedShapes = [...folded].sort((x, y) => x.openedAt.localeCompare(y.openedAt) || x.key.localeCompare(y.key)).map(shape);
ok("every stored incident equals the fold's, field for field", JSON.stringify(storedShapes) === JSON.stringify(foldedShapes),
  `\n    stored ${storedShapes.join("\n           ")}\n    folded ${foldedShapes.join("\n           ")}`);
ok("8 steps in all: seven openings and one escalation",
  (await count(`select count(*) n from card_fraud_incident_attempts where org_id = $1 and step is not null`, [ORG])) === 8);
ok("every opening attempt is marked 'opened'",
  (await count(`select count(*) n from card_fraud_incident_attempts where org_id = $1 and step = 'opened'`, [ORG])) === 7);

// ── 2. A re-score changes nothing ───────────────────────────────────────────────────────────
const before = JSON.stringify((await db.query(`select id, version, steps from card_fraud_incidents order by id`)).rows);
const rescored = [];
for (const a of attempts) rescored.push(...(await record(ORG, a)));
ok("re-recording every attempt records nothing", !rescored.includes("recorded"), rescored.join(","));
ok("…and leaves every incident, version and step as it was",
  JSON.stringify((await db.query(`select id, version, steps from card_fraud_incidents order by id`)).rows) === before);
// An attempt already stored in an OLDER incident is not visible to the fold (it reads the latest);
// the database still refuses it.
const southBend = attempts.find((a) => a.at === "2026-09-22T19:24:00Z");
const latestSb = await latestOf(ORG, cardFraudKey(southBend.cardRef, southBend.vehicleId));
const late = applyFraudAttempt(await asIncident(latestSb), southBend);
ok("an attempt already in an older incident is refused as a duplicate",
  (await outcomeOf(write(ORG, southBend, latestSb, late))) === "duplicate");

// ── 3. Two workers on one card ──────────────────────────────────────────────────────────────
const card = "7083050000000399999";
const veh = (await one(`insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1, '901', 150) returning id`, [ORG])).id;
const tryAt = (at, o = {}) => ({
  id: crypto.randomUUID(), source: "decline", at, cardRef: card, vehicleId: veh, city: "GARY", state: "IN",
  samsaraAtStation: false, explainedByFill: false, reason: "invalid_info", failedPrompt: null, truck: null, ...o,
});
const w1 = tryAt("2026-10-06T10:00:00Z");
const w2 = tryAt("2026-10-06T10:00:30Z");
const outcomes = await record(ORG, w2, () => record(ORG, w1));
ok("a worker whose read went stale is refused, and its retry records", outcomes.join(",") === "moved,recorded", outcomes.join(","));
ok("…so two simultaneous openings make ONE incident",
  (await count(`select count(*) n from card_fraud_incidents where card_ref = $1`, [card])) === 1);
ok("…holding both attempts",
  (await count(`select count(*) n from card_fraud_incident_attempts a join card_fraud_incidents i on i.id = a.incident_id where i.card_ref = $1`, [card])) === 2);
// A raw stale write (no retry): the version moved since it was read.
const g1 = await latestOf(ORG, cardFraudKey(card, veh));
const w3 = tryAt("2026-10-06T11:00:00Z", { city: "HAMMOND" });
const r3 = applyFraudAttempt(await asIncident(g1), w3);
await record(ORG, tryAt("2026-10-06T10:30:00Z"));
ok("an update at an old version is refused as 'moved'", (await outcomeOf(write(ORG, w3, g1, r3))) === "moved");
ok("a refused write stores no attempt",
  (await count(`select count(*) n from card_fraud_incident_attempts where source_id = $1`, [w3.id])) === 0);
const g2 = await latestOf(ORG, cardFraudKey(card, veh));
ok("naming an incident that is not the one read raises",
  /not the one read/.test(await err(db.query(
    `select * from card_fraud_record($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
    [ORG, cardFraudKey(card, veh), card, g2.id, g2.version, stored[0].id, g2.incident_key, veh, g2.opened_at, g2.last_attempt_at,
      "alert", 4, false, JSON.stringify(g2.places), [], JSON.stringify(g2.steps), null, "decline", crypto.randomUUID(), g2.last_attempt_at, null],
  )) ?? ""));

// ── 4. A person's close is never undone ─────────────────────────────────────────────────────
const w4 = tryAt("2026-10-06T12:00:00Z");
const closeIt = () => db.query(
  `update card_fraud_incidents set status = 'dismissed', disposition = 'false_positive', disposition_by = $2, disposition_at = now()
    where id = $1`, [g2.id, REVIEWER]);
const closedOutcomes = await record(ORG, w4, closeIt);
ok("an attempt landing as a person closes the incident is refused, then recorded", closedOutcomes.join(",") === "closed,recorded", closedOutcomes.join(","));
const afterClose = (await db.query(`select status, attempt_count from card_fraud_incidents where card_ref = $1 order by opened_at`, [card])).rows;
ok("…into a NEW incident; the dismissed one keeps its count",
  afterClose.length === 2 && afterClose[0].status === "dismissed" && afterClose[0].attempt_count === 3 && afterClose[1].status === "open",
  JSON.stringify(afterClose));
// The card now has two incidents; the next attempt must find the NEWER one as its latest.
const w5 = tryAt("2026-10-06T12:10:00Z");
const next = await record(ORG, w5);
const reopened = (await db.query(`select attempt_count from card_fraud_incidents where card_ref = $1 order by opened_at`, [card])).rows;
ok("the next attempt joins the card's newest incident, not the dismissed one",
  next.join(",") === "recorded" && reopened.length === 2 && reopened[1].attempt_count === 2, `${next} ${JSON.stringify(reopened)}`);

// ── 5. Shape guards ─────────────────────────────────────────────────────────────────────────
const raw = (cols) =>
  db.query(
    `insert into card_fraud_incidents (org_id, incident_key, card_key, card_ref, opened_at, last_attempt_at, level, attempt_count, places, steps${cols.extra ?? ""})
     values ($1, $2, 'k', 'k', '2026-10-01', '2026-10-01', ${cols.level ?? "'alert'"}, 1, ${cols.places ?? `'[{}]'`}, '[{}]'${cols.values ?? ""}) returning id`,
    [cols.org ?? ORG, crypto.randomUUID()],
  );
ok("a closed incident without an outcome is refused",
  /closed_has_outcome/.test(await err(raw({ extra: ", status", values: ", 'resolved'" })) ?? ""));
ok("an unknown level is refused", (await err(raw({ level: "'critical'" }))) !== null);
ok("an incident with no place is refused", (await err(raw({ places: `'[]'` }))) !== null);
ok("a failed prompt outside odometer/driver ID is refused",
  (await err(raw({ extra: ", failed_prompts", values: ", array['unit_number']" }))) !== null);
const otherInc = (await raw({ org: OTHER })).rows[0].id;
ok("an attempt cannot sit in another org's incident",
  /foreign key/i.test(await err(db.query(
    `insert into card_fraud_incident_attempts (source, source_id, org_id, incident_id, attempted_at) values ('decline', gen_random_uuid(), $1, $2, now())`,
    [ORG, otherInc])) ?? ""));

// ── 6. A reviewed incident cannot be deleted ────────────────────────────────────────────────
const [dismissed, open] = (await db.query(`select id from card_fraud_incidents where card_ref = $1 order by opened_at`, [card])).rows.map((r) => r.id);
ok("deleting a dismissed incident is refused", /reviewed_incident/.test(await err(db.query(`delete from card_fraud_incidents where id = $1`, [dismissed])) ?? ""));
await db.query(`update card_fraud_incidents set status = 'investigating' where id = $1`, [open]);
ok("deleting an incident under investigation is refused", /reviewed_incident/.test(await err(db.query(`delete from card_fraud_incidents where id = $1`, [open])) ?? ""));
await db.query(`update card_fraud_incidents set status = 'open', disposition = 'inconclusive' where id = $1`, [open]);
ok("deleting an open incident with a disposition is refused", /reviewed_incident/.test(await err(db.query(`delete from card_fraud_incidents where id = $1`, [open])) ?? ""));
await db.query(`update card_fraud_incidents set disposition = null where id = $1`, [open]);
ok("an untouched incident may be deleted", (await err(db.query(`delete from card_fraud_incidents where id = $1`, [open]))) === null);
ok("…and its attempts go with it",
  (await count(`select count(*) n from card_fraud_incident_attempts where incident_id = $1`, [open])) === 0);
await db.query(`update card_fraud_incidents set status = 'resolved', disposition = 'confirmed' where org_id = $1`, [OTHER]);
await db.query(`insert into card_fraud_incident_attempts (source, source_id, org_id, incident_id, attempted_at) values ('fill', gen_random_uuid(), $1, $2, now())`, [OTHER, otherInc]);
ok("deleting the organization still removes its reviewed incidents and attempts",
  (await err(db.query(`delete from organizations where id = $1`, [OTHER]))) === null
    && (await count(`select count(*) n from card_fraud_incidents where org_id = $1`, [OTHER])) === 0
    && (await count(`select count(*) n from card_fraud_incident_attempts where org_id = $1`, [OTHER])) === 0);

// ── 7. Service role only ────────────────────────────────────────────────────────────────────
for (const t of ["card_fraud_incidents", "card_fraud_incident_attempts"]) {
  ok(`${t}: row level security is on`, (await one(`select relrowsecurity r from pg_class where relname = $1`, [t])).r === true);
  ok(`${t}: no client policy exists`, (await count(`select count(*) n from pg_policies where tablename = $1`, [t])) === 0);
}
const sig = "public.card_fraud_record(uuid, text, text, uuid, int, uuid, text, uuid, timestamptz, timestamptz, text, int, boolean, jsonb, text[], jsonb, jsonb, text, uuid, timestamptz, text)";
const g = await one(
  `select has_function_privilege('authenticated', $1, 'execute') a, has_function_privilege('anon', $1, 'execute') n,
          has_function_privilege('service_role', $1, 'execute') s`, [sig]);
ok("card_fraud_record: service role only", !g.a && !g.n && g.s, JSON.stringify(g));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
