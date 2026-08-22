import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Data retention as code — the single place that says how long each table's rows live, and the runner
 * that enforces it in bounded batches. Runs daily per org through the jobs ledger (kind
 * `data_retention`), so growth is capped by POLICY instead of by the next incident.
 *
 * Principles:
 *  - Only DERIVED or REPRODUCIBLE data is pruned: raw telematics whose aggregates live on in
 *    idle_rollup_days, finished job rows, and rebuildable caches. Business records (fuel/EFS
 *    transactions, anomalies, driver scores) and the audit ledger are NEVER listed here — audit_logs is
 *    an append-only compliance record and pruning it would be evidence destruction (a guard test pins
 *    this).
 *  - Deletes are BOUNDED — id batches through the existing (org_id, time) indexes, or oldest-first time
 *    slices for tables without an id column — never one giant DELETE that could blow the statement
 *    timeout (the same failure mode the HOS sync hit for writes).
 *  - Each run is capped per table; a backlog converges over successive daily runs instead of producing
 *    one monster run.
 */

/** Ids per delete statement (id strategy). */
const BATCH = 1000;
/** Max delete statements per table per run — a backlog drains across daily runs. */
const MAX_BATCHES = 30;
/** Time-slice width for tables pruned oldest-first without an id column. */
const SLICE_MS = 30 * 86_400_000;
/** Max time slices per table per run. */
const MAX_SLICES = 12;

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
];

/** Tables that must NEVER appear in RETENTION_RULES — pinned by a guard test. */
export const RETENTION_FORBIDDEN = [
  "audit_logs", // append-only compliance ledger
  "platform_audit_log",
  "fuel_transactions", // business records
  "efs_transactions",
  "efs_card_mutations", // card-control ledger
  "fuel_events",
  "declined_transactions",
  "anomalies",
  "driver_scores",
  "driver_performance_weeks", // frozen rewards ledger
  "organizations",
  "drivers",
  "vehicles",
  /**
   * D-BD12 — the driver qualification file. §391.51 measures retention in YEARS (the MVR review for
   * three, the file itself for as long as the driver is employed plus three), and §390.32(d) requires
   * an electronic record to still be reproducible when asked for. Until now nothing stopped someone
   * adding these to a retention rule in six months and quietly pruning a driver's history — the
   * history the binder is built to reproduce. `documents` is the scan behind every one of these rows
   * and is append-only by RLS for exactly the same reason.
   */
  "certifications",
  "qualification_records",
  "documents",
  /**
   * H5 — the §391.21 application and the invitation that produced it. The application is the
   * document the applicant CERTIFIED as true and complete, and every §391.23 inquiry, the PSP
   * cross-match and the §391.51(b)(1) record all point back at it; pruning it would leave the file
   * citing evidence that no longer exists. The invitation stays because it is the provenance of an
   * unauthenticated signature — who was invited, when it expired, when it was spent.
   */
  "driver_applications",
  "application_invitations",
  /** The export ledger (0152). The bytes expire after seven days; the row that says who pulled a
   *  driver's medical card out of the system does not (D-BD9). */
  "dq_exports",
  /**
   * The §391.21(b)(10) employment list (0208). Same reasoning as `qualification_records` above and
   * the same clock: §391.51(c) keeps the qualification file for as long as the driver is employed
   * plus three years, and §391.53(a)(1) keeps the investigation history it records the inquiries for.
   * Mutable — a transcription correction is an UPDATE, unlike the append-only evidence tables — but
   * mutability is not the same axis as retention, and `drivers` sits on this list for the same reason.
   */
  "driver_employment_history",
  /**
   * The §391.23(c)(2) written record of every previous-employer inquiry (0223).
   *
   * This one is not merely evidence OF the investigation — when nobody answers, it IS the
   * investigation: §391.23(c)(1) accepts "documentation of good faith efforts" in place of a reply,
   * so pruning the attempts would delete the only proof the file was ever completed lawfully. It
   * keeps the §391.53(a)(1) clock its qualification records keep.
   */
  "employer_inquiries",
  /**
   * The signed disclosures and authorizations (0215). The legal basis for a screening pull outlives
   * the pull: an FCRA or §391.23 challenge asks what the driver was told and when they agreed, and a
   * consent record that can be aged out is a consent record that cannot answer.
   */
  "driver_authorizations",
  /**
   * The PSP transaction ledger (0216). Every row is a purchase and a person's crash and violation
   * history — the record of what we bought, on whose authorization, and what it said. An invoice
   * reconciliation reads it, and so does anyone asking why a hiring decision went the way it did.
   */
  "psp_requests",
  /**
   * The 15 U.S.C. 7001(c) consent behind every electronic signature this product takes (0227).
   *
   * §390.32(d) does not merely ask us to obtain it — it makes the electronic record itself
   * conditional on including proof of it, and asks that the record still be accurately reproducible
   * when somebody comes looking. A consent that can be aged out is a consent that cannot answer the
   * one question it exists to answer, and pruning it would retroactively turn every application and
   * signature it stands behind into an electronic record FMCSA does not recognise.
   */
  "esign_consents",
] as const;

export interface RetentionTableResult {
  table: string;
  deleted: number;
  /** True when the per-run cap was hit — more rows remain and tomorrow's run continues. */
  capped: boolean;
}

export interface RetentionResult {
  tables: RetentionTableResult[];
  totalDeleted: number;
}

const cutoffFor = (rule: RetentionRule): string => {
  const iso = new Date(Date.now() - rule.keepDays * 86_400_000).toISOString();
  return rule.timeColumn === "day" ? iso.slice(0, 10) : iso; // DATE columns compare on the date part
};

/** id strategy: select a batch of ids past the cutoff (via the (org_id, time) index), delete by id. */
async function pruneById(
  admin: SupabaseClient,
  orgId: string,
  rule: RetentionRule,
): Promise<RetentionTableResult> {
  const cutoff = cutoffFor(rule);
  let deleted = 0;
  let batches = 0;
  for (; batches < MAX_BATCHES; batches++) {
    let q = admin
      .from(rule.table)
      .select("id")
      .lt(rule.timeColumn, cutoff)
      .order(rule.timeColumn, { ascending: true })
      .limit(BATCH);
    if (rule.orgScoped) q = q.eq("org_id", orgId);
    if (rule.onlyWhenIn) q = q.in(rule.onlyWhenIn.column, rule.onlyWhenIn.values);
    const { data, error } = await q;
    if (error) throw new Error(`${rule.table} select: ${error.message}`);
    const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
    if (ids.length === 0) break;
    let d = admin.from(rule.table).delete().in("id", ids);
    if (rule.orgScoped) d = d.eq("org_id", orgId);
    const { error: derr } = await d;
    if (derr) throw new Error(`${rule.table} delete: ${derr.message}`);
    deleted += ids.length;
    if (ids.length < BATCH) {
      batches++;
      break;
    }
  }
  return { table: rule.table, deleted, capped: batches >= MAX_BATCHES };
}

/** timeSlice strategy (composite-PK tables): delete oldest-first 30-day slices up to the cutoff. */
async function pruneByTimeSlice(
  admin: SupabaseClient,
  orgId: string,
  rule: RetentionRule,
): Promise<RetentionTableResult> {
  const cutoff = cutoffFor(rule);
  let deleted = 0;
  let slices = 0;
  for (; slices < MAX_SLICES; slices++) {
    let oq = admin
      .from(rule.table)
      .select(rule.timeColumn)
      .not(rule.timeColumn, "is", null)
      .order(rule.timeColumn, { ascending: true })
      .limit(1);
    if (rule.orgScoped) oq = oq.eq("org_id", orgId);
    const { data: oldestRows, error: oerr } = await oq;
    if (oerr) throw new Error(`${rule.table} oldest: ${oerr.message}`);
    const oldest = (oldestRows?.[0] as Record<string, string> | undefined)?.[rule.timeColumn];
    // Numeric compare — PostgREST may format timestamptz with "+00:00" while our cutoff uses "Z".
    if (!oldest || Date.parse(oldest) >= Date.parse(cutoff)) break;
    const sliceEnd = new Date(
      Math.min(Date.parse(oldest) + SLICE_MS, Date.parse(cutoff)),
    ).toISOString();
    let d = admin
      .from(rule.table)
      .delete({ count: "exact" })
      .lt(rule.timeColumn, sliceEnd)
      .not(rule.timeColumn, "is", null);
    if (rule.orgScoped) d = d.eq("org_id", orgId);
    const { count, error: derr } = await d;
    if (derr) throw new Error(`${rule.table} delete: ${derr.message}`);
    deleted += count ?? 0;
  }
  return { table: rule.table, deleted, capped: slices >= MAX_SLICES };
}

/** Enforce every retention rule for one org. Rules are independent — one failing table doesn't stop the
 *  rest; the first error is rethrown at the end so the job records the failure after doing all it could. */
export async function runDataRetention(
  admin: SupabaseClient,
  orgId: string,
  rules: RetentionRule[] = RETENTION_RULES,
): Promise<RetentionResult> {
  const tables: RetentionTableResult[] = [];
  let firstError: Error | null = null;
  for (const rule of rules) {
    try {
      const r =
        rule.strategy === "id"
          ? await pruneById(admin, orgId, rule)
          : await pruneByTimeSlice(admin, orgId, rule);
      if (r.deleted > 0 || r.capped) {
        console.log(
          `[retention] ${rule.table}: deleted ${r.deleted} rows older than ${rule.keepDays}d` +
            (r.capped ? " (capped — continues next run)" : ""),
        );
      }
      tables.push(r);
    } catch (e) {
      firstError ??= e instanceof Error ? e : new Error(String(e));
      console.error(`[retention] ${rule.table} failed: ${firstError.message}`);
      tables.push({ table: rule.table, deleted: 0, capped: false });
    }
  }
  if (firstError) throw firstError;
  return { tables, totalDeleted: tables.reduce((s, t) => s + t.deleted, 0) };
}
