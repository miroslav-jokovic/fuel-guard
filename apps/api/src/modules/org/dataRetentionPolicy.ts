/**
 * Data retention POLICY — how long each table's rows live, and which tables may never be touched.
 *
 * Split out of dataRetention.ts on 2026-09-22 (DATA-LIFECYCLE-PLAN L3), which added the
 * `scoring_attempts` rule and pushed that file to 526 lines against a 500-line budget. The seam is
 * policy vs mechanism: WHAT the windows are lives here, HOW rows are deleted in bounded batches
 * stays next door. `lint:filesize` says plainly that a waiver is the deliberate alternative to a
 * split, and there was a real seam to cut on, so it was cut.
 *
 * ⚠ `scripts/check-table-lifecycle.mjs` PARSES THIS FILE to prove `RETENTION_RULES` and the
 * `lifecycle.retention_days` in scripts/table-modules.json agree in both directions (D-LIFE2). If
 * this file is ever renamed or the rules move again, that gate's RETENTION_TS constant moves with
 * them or it silently starts reading an empty rule set — the exact class of failure the gate exists
 * to catch, one level up. The never-touch list moved to `dataRetentionForbidden.ts` on 2026-10-10
 * (re-exported below); the gate's FORBIDDEN_TS reads it there.
 *
 * Principles (unchanged by the split):
 *  - Only DERIVED or REPRODUCIBLE data is pruned. Business records and the audit ledger are never
 *    listed here; `RETENTION_FORBIDDEN` is the machine-readable statement of that.
 *  - Every window must be REACHABLE and justified against a reader. A window longer than the
 *    product's own data history is not a policy — measured 2026-09-21, retention had run 381 times
 *    in seven days and deleted nothing, because every table was younger than its own 400-day rule.
 */
export interface RetentionRule {
  table: string;
  /** Column the cutoff compares against (rows strictly older are pruned). */
  timeColumn: string;
  keepDays: number;
  /** "id": select ids past cutoff → delete by id (needs an `id` column). "timeSlice": delete oldest-first
   *  30-day slices (for composite-PK tables). */
  strategy: "id" | "timeSlice";
  /** False for global caches without an org_id column. */
  orgScoped: boolean;
  /** Extra filter, e.g. jobs: only finished runs. Column → value-list (IN). */
  onlyWhenIn?: { column: string; values: string[] };
  /** Why this retention is safe — the policy rationale, kept next to the number. */
  why: string;
}

/**
 * The policy. Raw telematics: 400 days (rolling ~13 months) — idle_rollup_days carries the history the
 * product needs beyond that, and the Samsara API can re-backfill if ever required. Finished jobs: 90
 * days is ample for the Data & Sync freshness UI. Caches: rebuilt/re-fetched on demand.
 */
export const RETENTION_RULES: RetentionRule[] = [
  {
    /**
     * L3, docs/plans/architecture/DATA-LIFECYCLE-PLAN.md. The largest single line in the growth audit:
     * 991 MB and 2.21M rows/30d — 12.1 GB/year, more than `audit_logs` — and until 2026-09-22 this
     * table had NO rule at all, in a policy whose first principle is that derived and reproducible
     * data is pruned.
     *
     * 45 DAYS IS DERIVED, NOT CHOSEN. `scoringHealth()` is the only reader, and it clamps its own
     * window to `Math.min(..., 30)` days — so 30 is the hard floor and 45 leaves a fortnight of
     * headroom. `backfill.ts` only NAMES the table in an error string ("see scoring_attempts"); it
     * does not query it. The other purpose — 0156's idempotency guard, where a repeated call with the
     * same attempt id must not apply its writes twice — is satisfied in seconds, not weeks.
     *
     * ⚠ THIS PRUNES A SYMPTOM. Measured 2026-09-21/22: 2,415,317 attempts against 17,293 fuel
     * transactions is **139.7 attempts per transaction**, and the hourly profile shows 2,000–7,500
     * DISTINCT transactions rescored every hour against only ~200 new fills a day — a continuous
     * full-fleet rescan, not new work. 677 distinct `engine_version` values cover just 6 distinct
     * ruleset hashes, so ~99% of those rescores could not have changed a verdict. Retention caps the
     * storage; it does not stop the work. The driver is Q6 in the plan.
     */
    table: "scoring_attempts",
    timeColumn: "started_at",
    keepDays: 45,
    strategy: "id",
    orgScoped: true,
    why: "derived idempotency/telemetry ledger for the scoring engine, rebuildable by re-scoring; scoringHealth() reads at most 30 days (L3, D-LIFE5)",
  },
  {
    table: "idle_events",
    timeColumn: "started_at",
    keepDays: 400,
    strategy: "id",
    orgScoped: true,
    why: "raw Samsara idling events; aggregated into idle_rollup_days",
  },
  {
    table: "hos_duty_segments",
    timeColumn: "started_at",
    keepDays: 400,
    strategy: "id",
    orgScoped: true,
    why: "raw ELD duty intervals; duty split preserved in idle_rollup_days",
  },
  {
    table: "idle_park_sessions",
    timeColumn: "started_at",
    keepDays: 400,
    strategy: "id",
    orgScoped: true,
    why: "derived park sessions; mode split preserved in idle_rollup_days",
  },
  {
    table: "idle_telemetry_windows",
    timeColumn: "synced_at",
    keepDays: 400,
    strategy: "id",
    orgScoped: true,
    why: "derived current-window telemetry evidence; rebuilt from Samsara vehicle stats",
  },
  {
    table: "vehicle_engine_days",
    timeColumn: "day",
    keepDays: 400,
    strategy: "id",
    orgScoped: true,
    why: "per-day engine totals; mirrored in idle_rollup_days",
  },
  {
    /**
     * IE2 (0404, D-IE8): the idle engine's hour rows are kept 60 days. They are rebuildable from
     * Samsara for any window, and what outlives them is `idle_engine_days` (derived from these
     * hours by the writer) and `idle_engine_stops` — both kept. A plain table with this delete
     * instead of pg_partman partitions: Q-IE8 in FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md. Composite
     * primary key, so oldest-first time slices; ~4,400 rows a day leave per run.
     */
    table: "idle_engine_hours",
    timeColumn: "hour_start",
    keepDays: 60,
    strategy: "timeSlice",
    orgScoped: true,
    why: "derived hourly buckets, rebuildable from Samsara; day totals and stops outlive them in idle_engine_days / idle_engine_stops (IE2, D-IE8)",
  },
  {
    table: "driver_vehicle_assignments",
    timeColumn: "end_at",
    keepDays: 400,
    strategy: "timeSlice",
    orgScoped: true,
    why: "closed assignment intervals (lt on end_at never matches open ones); attribution stored on rollup days",
  },
  {
    table: "jobs",
    timeColumn: "created_at",
    keepDays: 90,
    strategy: "id",
    orgScoped: true,
    onlyWhenIn: { column: "status", values: ["done", "failed"] },
    why: "finished background-job ledger rows; freshness UI only needs recent history",
  },
  {
    table: "route_geometries",
    timeColumn: "created_at",
    keepDays: 180,
    strategy: "id",
    orgScoped: false,
    why: "global route polyline cache; re-fetched on demand",
  },
  {
    table: "weather_cache",
    timeColumn: "hour_utc",
    keepDays: 400,
    strategy: "timeSlice",
    orgScoped: false,
    why: "global hourly weather grid; only consulted for events inside the raw-telematics window",
  },
  /**
   * D-LD8. 49 CFR Part 379 App. A puts freight bills and bills of lading at ONE year — but Carmack
   * (49 U.S.C. §14706(e)) lets a shipper file for nine months after delivery and sue for two years
   * after a denial, so a proof-of-delivery photo can decide a claim close to three years out.
   * Retaining for the regulatory floor and destroying the photograph that would have won the claim is
   * the worst of both: compliant, and out of pocket.
   *
   * Deleting the row is the whole mechanism. The object then has no row pointing at it, and the
   * `load-photos` orphan sweep already running in storageReconcileScheduler removes the bytes
   * on its next pass after the 24-hour grace. Two mechanisms built for other reasons compose into
   * the policy, and neither had to change.
   */
  {
    table: "load_stop_photos",
    timeColumn: "uploaded_at",
    keepDays: 1095,
    strategy: "id",
    orgScoped: true,
    why: "proof-of-work photos; 3y covers the Carmack claim window (9mo to file + 2y to sue) past the 1y §379 floor",
  },
  /**
   * A11a, and the entries that make D-APP2's and D-APP10's word "prunable" true rather than
   * aspirational. Both tables took 0213's trigger style — `auth_role() is null` PASSES, which is the
   * service role this runner is — specifically so that these two lines could exist. The EI010/DA010
   * family, correct for evidence, would have made the promise structurally false.
   *
   * ── WHAT IS ACTUALLY BEING DELETED, AND WHY IT IS NOT EVIDENCE ────────────────────────────────
   * A half-typed application and the photographs staged against it. Nobody signed either, nothing
   * cites them, and §391.51 does not ask for them. What they DO hold is a date of birth, an address
   * history, a licence number and a photograph of a licence — for a person who, in every row these
   * rules can reach, never applied. The moment an application IS certified, the answers become
   * `driver_applications.payload` and the accepted photographs become `documents` rows, both of which
   * are in `RETENTION_FORBIDDEN` and neither of which these rules can touch.
   *
   * ── ⚠ THE WINDOW IS MEASURED FROM THE LAST TOUCH, NOT FROM THE INVITATION'S EXPIRY ────────────
   * A11's text says "a configured window after their invitation expires or its lead is dispositioned".
   * That needs a join this engine deliberately cannot express — every rule here compares one column on
   * one table, which is what keeps the policy readable as a list. The last touch is also the better
   * measure: the question retention answers is "how long has this personal data been sitting here
   * unused", not "how long ago did a credential lapse". A draft somebody is still filling in is never
   * pruned, because saving moves `updated_at`.
   *
   * ── AND DELETING THE ROW IS THE WHOLE MECHANISM FOR THE BYTES ─────────────────────────────────
   * `load_stop_photos` above set the pattern. A staged capture's row is what the
   * `application-captures` orphan sweep (A8a) checks Storage against, so a deleted row makes its
   * object an orphan, and the object is removed on the sweep's next pass after the 24-hour grace.
   * Two mechanisms built for other reasons compose into the policy, and neither had to change.
   *
   * ⚠ `signature_mark` is pruned with everything else — the decision A8b deferred to this step, taken
   * rather than discovered. The staged row is how the PDF renderer FINDS the drawn mark, so after the
   * window a re-render draws the typed name alone. That is exactly what D-APP8 says the signature of
   * record has always been, the PDF filed on the day keeps its mark for ever, and a retention rule
   * with an exemption in it is a retention rule the next reader gets wrong.
   */
  {
    table: "application_drafts",
    timeColumn: "updated_at",
    keepDays: 90,
    strategy: "id",
    orgScoped: true,
    why: "D-APP2: a half-typed §391.21 form holding a DOB and an address history for somebody who never applied; the certified answers live on in driver_applications.payload, which is RETENTION_FORBIDDEN",
  },
  {
    table: "application_captures",
    timeColumn: "captured_at",
    keepDays: 90,
    strategy: "id",
    orgScoped: true,
    why: "D-APP10: staged photographs of a licence and a medical card for somebody who never applied; an accepted set becomes documents rows at submit, which are RETENTION_FORBIDDEN, and the storage objects follow the row via the application-captures orphan sweep",
  },
  {
    /**
     * The §395.8(j)(2) seven-day work statement (0236, D-PKT7).
     *
     * ⚠ **This is the first table in this list that is EVIDENCE and still prunable**, so the reasoning
     * is worth stating rather than leaving to the migration header. It is immutable on UPDATE — a
     * driver signed it, and a signed statement somebody can edit is not a statement — and it is
     * deliberately NOT in `RETENTION_FORBIDDEN`, because §395.8(k)(1) obliges the carrier to keep a
     * supporting document for SIX MONTHS. Keeping a record of somebody's working hours for ever, when
     * the rule asks for six months, is over-retention of personal data dressed up as diligence.
     *
     * 400 days rather than 180: a generous margin over the statutory floor, so an audit arriving a
     * year after a hire still finds the statement, and the driver's hours still age out.
     */
    table: "seven_day_statements",
    timeColumn: "statement_date",
    keepDays: 400,
    strategy: "id",
    orgScoped: true,
    why: "D-PKT7: §395.8(k)(1) asks for six months of supporting documents; 400 days keeps an audit margin without holding a person's working hours indefinitely. Immutable on UPDATE (SD010) but prunable by design — see 0236's header",
  },
  {
    // 0363. A reset link is dead within the hour; the row after that is only a hash nobody can use.
    // The record of who asked, who sent it and whether it was used lives in `audit_logs`
    // (`auth.password_reset_*`), which is RETENTION_FORBIDDEN — so pruning here forgets nothing.
    table: "password_resets",
    timeColumn: "created_at",
    keepDays: 30,
    strategy: "id",
    orgScoped: true,
    why: "0363: a reset link lives 60 minutes; the durable record of every request and completion is audit_logs (auth.password_reset_*), which this rule cannot touch",
  },
  {
    // 0376 / C2d. One row per text the product sent or queued: a template name, its params and a
    // phone number — never the words or a link. The consent each rests on is `sms_consents`, kept
    // for ever; this is the delivery log, and a phone number held beyond a year's audit margin is
    // retention for its own sake.
    table: "sms_outbox",
    timeColumn: "created_at",
    keepDays: 400,
    strategy: "id",
    orgScoped: true,
    why: "A-11/D-AW12 (APPLICATION-FLOW-V2-PLAN §8.2): the delivery log of texts sent or queued — template, params, number, status; the consent behind each is sms_consents, which this rule cannot touch",
  },
  {
    // 0376 / C3d3a (AW14). One row per screen an applicant's page showed: a screen's NAME and two times,
    // never an answer. Its only reader is §6.8's completion-time query, which looks at recent links;
    // 180 days is 0376's own promise, and two quarters of hiring is enough to see a trend and old
    // enough that nobody's visits are kept past the question they answer.
    table: "application_screen_events",
    timeColumn: "entered_at",
    keepDays: 180,
    strategy: "id",
    orgScoped: true,
    why: "AW14 (APPLICATION-FLOW-V2-PLAN §6.8): screen visits on the applicant's link, names and times only, read by the completion-time query; 180 days as 0376's table comment promised",
  },
  {
    // DATA-LIFECYCLE-PLAN Q11 (ruled (b), 2026-10-05). Prunable ONLY because 0432 moved the dedupe
    // keys to `notification_dedupe_keys` (pinned in RETENTION_FORBIDDEN) — this rule ships in the
    // same merge as the schedulers' move to that ledger, so a revert takes both. 90 days against the
    // readers: the bell shows the newest 100, the push sweep reads minutes-old rows, and the routing
    // plan's counts read 30 days. Reads cascade with their event. Measurements: the plan's Q11.
    table: "notification_events",
    timeColumn: "created_at",
    keepDays: 90,
    strategy: "id",
    orgScoped: true,
    why: "Q11 (DATA-LIFECYCLE-PLAN): the bell's inbox — newest 100 shown, unpushed rows minutes old; dedupe keys live in notification_dedupe_keys since 0432, so a pruned event re-sends nothing",
  },
  {
    // 0453 (DISPATCH-BOARD-PLAN DB7). A measurement instrument, not a record: the board's hourly ETA
    // per truck, read only by DB7's comparison against arrivals over a fortnight. 60 days holds two
    // such fortnights and a re-run after a basis change; the stop and its arrival stay in `load_stops`.
    table: "load_stop_eta_predictions",
    timeColumn: "predicted_at",
    keepDays: 60,
    strategy: "id",
    orgScoped: true,
    why: "DB7 (DISPATCH-BOARD-PLAN): the dispatch board's recorded ETAs, scored against arrivals over two weeks; the stop and its actual arrival live on in load_stops",
  },
];

export { RETENTION_FORBIDDEN } from "./dataRetentionForbidden.js";
