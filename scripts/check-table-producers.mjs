#!/usr/bin/env node
/**
 * Fitness function — no table ships without a producer.
 *
 * The 2026-08-26 audit found four tables merged two days earlier with zero application code
 * (`financial_entries` + three `mcleod_*` staging tables), a table dead since 0097 that three
 * roster FKs still point at (`terminals`), and two more dead since the platform's first weeks
 * (`ai_verifications`, `import_rows`). Schema that nothing writes is not infrastructure, it is a
 * promise nobody is keeping — and the reader who finds it cannot tell the difference. This gate
 * makes the promise explicit: a table is either written somewhere, or it is on the pinned waiver
 * list below with a reason and a plan (docs/ARCHITECTURE.md §6, D-ARC3).
 *
 * "Producer" evidence, either of:
 *   - a supabase-js write or read in non-test application source: `.from("<table>")` — reads count
 *     because a read-only projection fed by an RPC (e.g. `org_usage_month`) is still alive;
 *   - DML inside a migration-defined function body: `insert into` / `update` / `delete from`
 *     <table> — this is how RPC-fed tables (`card_write_counters`, `anomaly_transitions`) are
 *     reached without ever appearing in a `.from()`.
 * FK `references`, policies, and index DDL are NOT evidence — `terminals` has all three and is dead.
 *
 * The waiver list may only shrink, or grow with a written justification in the same commit —
 * the check-file-size.mjs convention.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const MIGRATIONS = join(ROOT, "supabase", "migrations");

// Tables allowed to exist without a producer, each with the reason it is still pinned.
// Ratchet: entries leave when the table gains a producer or gets dropped; additions need a
// justification in the commit that adds them.
const WAIVERS = new Map([
  // unit_tags (0531, DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md DE3) left on 2026-10-30 in DE4:
  // maintenance/inventory/unitTags.ts issues a truck's or trailer's code on its first label print.
  // import_rows left this list on 2026-09-03: efsIngestRejects.ts writes it (D-FIN2).
  // vehicle_positions left it on 2026-09-15: migration 0342's `record_vehicle_positions` writes it,
  // driven by the LM4 positions tier (samsaraPositionsFeed.ts). The gate found the waiver stale by
  // itself, exactly as the entry said it would.
  // tms_dispatchers left it on 2026-09-23 (LOADS-GO-LIVE-PLAN.md L4): tmsDispatcherIngest.ts writes
  // it behind POST /api/tms/dispatchers. It was pinned for one merge only, because
  // lint:migration-ordering made 0344 ship schema-only; that merge is this one.
  // mcleod_dispatch_movements and mcleod_dispatch_stops left it on 2026-09-24 (LOADS-MIRROR-PLAN.md
  // LR3): dispatchMovementIngest.ts writes both behind POST /api/tms/dispatch-movements. Pinned for one
  // merge only, the schema-only LR1 — the same shape as tms_dispatchers above.
  // load_dispatches left it on 2026-09-24 (LOADS-MIRROR-PLAN.md LR-D2): loads/dispatchToDriver.ts writes
  // it behind POST /api/dispatch/loads/:id/dispatch. Pinned for the schema-only LR-D1 (0370) only.
  // road_test_examiners left it on 2026-09-25 (ROAD-TEST-PLAN.md RT3): recruiting/roadTest.ts writes it
  // behind POST /api/recruitment/road-test-examiners. Pinned for the schema-only RT0 (0372) only.
  // carrier_representatives and handbook_marks left it on 2026-09-25 (HANDBOOK-SIGNING-PLAN.md HB3):
  // recruiting/representatives.ts writes the first behind POST /api/recruitment/representatives, and
  // handbookCeremony.ts + handbookSigning.ts write the second. Pinned for the schema-only HB0 (0374) only.
  //
  // The five below were APPLICATION-FLOW-V2-PLAN.md §8.2's schema-only M1 (0376): a migration and its first
  // reader never share a merge. The other four tables 0376 creates are written by its own functions and
  // need no entry. Each leaves in the merge that ships its writer, named per entry. applicant_travel left
  // on 2026-09-26 (C2b2): recruiting/applicantTravel.ts writes it behind POST /recruitment/applicants/:driverId/travel.
  // drug_test_appointments left on 2026-09-26 (C2b3): recruiting/applicantDrugTest.ts writes it behind
  // POST /recruitment/applicants/:driverId/drug-test-appointments. sms_outbox left on 2026-09-26 (C2d):
  // recruiting/smsOutbox.ts writes it, drained by startSmsOutboxScheduler. sms_suppressions left on
  // 2026-09-27 (C2d2): recruiting/smsSuppressions.ts writes it from the Telnyx webhook's STOP and START.
  // application_screen_events left on 2026-09-28 (C3d3a): recruiting/applicationScreenEvents.ts writes it
  // behind POST /api/public/application/:token/screen-events. That was the last of the five.
  // recruiting_settings left on 2026-09-28 (APPLICATION-FLOW-V2-PLAN.md S2): recruiting/recruitingSettings.ts
  // writes it behind PUT /api/recruitment/settings. Pinned for the schema-only S1 (0379) only.
  // application_packet_countersignatures (0387, HANDBOOK-SIGNING-PLAN.md QH0) never needed an entry:
  // the migration's own `purge_applicant` deletes from it, which this gate counts as a reference.
  //
  // DOCUMENT-READER-PLAN.md Step 1.2 (0448) ships the reader's tables schema-only, ahead of the module
  // that writes them; `document_reads` needs no entry because 0448's own `document_read_transition`
  // updates it. Each leaves in the merge that ships its writer: the intake (Step 1.6 routes, 3.2 Samsara
  // copy) for sources, the normalisation stage (Step 1.3) for pages, the review route (Step 1.6) for reviews.
  // `document_pages` and `document_read_reviews` left with Step 1.6's read (executeRead.ts), which READS
  // both — a reference by this gate's definition; their writers are the intake and the review route.
  // `document_sources` left on 2026-10-10 with Step 1.6b: intake/intake.ts inserts it from the
  // `document_intake` job behind POST /api/documents/sources/:id/complete. That was the last of 0448's.
  // document_page_classes (0449, Q-DR12) left on 2026-10-11 with P2: read/classifyPages.ts writes the
  // classifier's verdict (class + rotation, 0456) for every page a read is given that has none.
  //
  // tms_fleets and driver_hos_clocks (0450, DISPATCH-BOARD-PLAN.md wave 1) left it in wave 2, the merge after
  // their schema: mcleod/fleetCodes.ts seeds the first from the roster sweep, samsara/hosClocksFeed.ts
  // writes the second from the clocks poll.
  //
  // file_intake_items (0505, UNIT-FILES-PLAN.md UF7a) ships schema-only: the plan splits UF7 as migration,
  // then the reader and the routes that write it. It leaves in UF7b, whose intake read inserts one row per
  // proposed paper and whose file/discard routes decide them.
  ["file_intake_items", "UNIT-FILES-PLAN.md UF7b — the compliance intake read and the file/discard routes write it (schema-only, 0505)"],
  //
  // The ads module's thirteen (0537, ADS-AGENT-BUILD-WORKFLOW.md A2) ship schema-only: the workflow
  // builds the store first and each worker after it, one PR per step. Each entry names the step whose
  // merge ships its writer and must remove the entry; the gate reports a stale one by itself.
  // A4 (2026-11-01): ad_generations left — modules/ads/generations/generationLedger.ts writes it (the AI
  // rail's provenance). ads_settings_versions left with it — the rail READS the newest version
  // (modules/ads/settings/settingsVersions.ts), and a read is producer evidence here; its save is A5.
  ["ad_brand_kits", "ADS-AGENT-BUILD-WORKFLOW.md C1 — the brand-kit API creates the kit (schema-only A2, 0537)"],
  ["ad_brand_kit_versions", "ADS-AGENT-BUILD-WORKFLOW.md C1 — the brand-kit API saves each version (schema-only A2, 0537)"],
  ["ad_concept_presets", "ADS-AGENT-BUILD-WORKFLOW.md C1 — the presets API seeds P1–P5 (schema-only A2, 0537)"],
  ["ad_concept_preset_versions", "ADS-AGENT-BUILD-WORKFLOW.md C1 — the presets API saves each version (schema-only A2, 0537)"],
  ["ads_platform_connections", "ADS-AGENT-BUILD-WORKFLOW.md B1 — Connect seals the token; step 7's simulator connects too (schema-only A2, 0537)"],
  ["ads_campaigns", "ADS-AGENT-BUILD-WORKFLOW.md A6 — the orchestrator creates the campaign from a brief (schema-only A2, 0537)"],
  ["ads_creatives", "ADS-AGENT-BUILD-WORKFLOW.md C2–C5 — the copywriter, renderer and checker write each creative (schema-only A2, 0537)"],
  ["ads_approvals", "ADS-AGENT-BUILD-WORKFLOW.md A5 — guard/approvals records a person's yes (schema-only A2, 0537)"],
  ["ads_actions", "ADS-AGENT-BUILD-WORKFLOW.md A5/A6 — budgetGuard and the orchestrator write every act and transition (schema-only A2, 0537)"],
  ["ads_outcome_events", "ADS-AGENT-BUILD-WORKFLOW.md B6 — the outcome feed queues a stage event from the LeadSink (schema-only A2, 0537)"],
  ["ads_spend_hourly", "ADS-AGENT-BUILD-WORKFLOW.md B5 — the hourly insights pull (schema-only A2, 0537)"],
  // orientation_videos (0539, HIRING-WORKFLOW-AUDIT-2026-10-31 §5 HW8a) ships schema-only: a migration and
  // its first reader never share a merge. Its two driver tables need no entry — 0539's own
  // `purge_applicant` deletes from them. It leaves in HW8a's second PR, whose Settings → Recruiting list
  // writes it (recruiting/orientationVideos.ts).
  ["orientation_videos", "HIRING-WORKFLOW-AUDIT-2026-10-31 §5 HW8a PR 2 — Settings → Recruiting's video list writes it (schema-only, 0539)"],
]);

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const CREATE_RE = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)/gi;
const DROP_RE = /drop\s+table\s+(?:if\s+exists\s+)?(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)/gi;

// Comments must be stripped before matching: "-- Rollback: drop table efs_soap_credentials."
// (0091) matched DROP_RE and silently removed two live tables from this gate's universe until
// 2026-08-27 — a table whose migration merely *mentions* dropping it escaped the producer
// requirement entirely.
const stripSql = (sql) => sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

const live = new Map(); // table → migration that created it
let allSql = "";
for (const f of files) {
  const sql = stripSql(readFileSync(join(MIGRATIONS, f), "utf8"));
  allSql += `\n${sql}`;
  for (const m of sql.matchAll(CREATE_RE)) if (!live.has(m[1].toLowerCase())) live.set(m[1].toLowerCase(), f);
  for (const m of sql.matchAll(DROP_RE)) live.delete(m[1].toLowerCase());
}

// Application source: every .from("<table>") in non-test, non-generated TS/Vue.
const SCAN_ROOTS = ["apps", "packages"].map((d) => join(ROOT, d));
const fromRefs = new Set();
const FROM_RE = /\.from\(\s*["'`]([a-z_][a-z0-9_]*)["'`]\s*\)/g;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".expo" || name === "ios" || name === "android") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!/\.(ts|tsx|vue|mjs)$/.test(name) || /\.test\.|\.spec\./.test(name)) continue;
    const src = readFileSync(p, "utf8");
    for (const m of src.matchAll(FROM_RE)) fromRefs.add(m[1]);
  }
}
for (const r of SCAN_ROOTS) walk(r);

// DML in migration function bodies reaches RPC-fed tables.
const dmlRefs = new Set();
for (const m of allSql.matchAll(/insert\s+into\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)/gi)) dmlRefs.add(m[1].toLowerCase());
for (const m of allSql.matchAll(/update\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)\s+set\s/gi)) dmlRefs.add(m[1].toLowerCase());
for (const m of allSql.matchAll(/delete\s+from\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)/gi)) dmlRefs.add(m[1].toLowerCase());

const orphans = [...live.entries()].filter(([t]) => !fromRefs.has(t) && !dmlRefs.has(t) && !WAIVERS.has(t));
const stale = [...WAIVERS.keys()].filter((t) => !live.has(t) || fromRefs.has(t) || dmlRefs.has(t));

if (stale.length) {
  console.error(`✗ ${stale.length} waiver(s) are stale — the table gained a producer or was dropped. Ratchet down:`);
  for (const t of stale) console.error(`   ${t}`);
  process.exit(1);
}
if (orphans.length) {
  console.error(`✗ ${orphans.length} table(s) have no producer anywhere:`);
  for (const [t, f] of orphans) console.error(`   ${t}  (created in ${f})`);
  console.error(
    "  A table needs application code that writes it (or an RPC whose body does) in the same PR" +
      " that merges its migration — or a pinned waiver here naming the plan that owes the producer.",
  );
  process.exit(1);
}
console.log(
  `✓ table producers ok — ${live.size} live tables, ${live.size - WAIVERS.size} produced, ${WAIVERS.size} waived pending their named plans.`,
);
