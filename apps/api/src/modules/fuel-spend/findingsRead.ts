import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CARD_FRAUD_KIND,
  FINDING_ASSIGNABLE_SECTIONS,
  anomalyStatusesIn,
  byOccurredDesc,
  canViewSection,
  detectionEpochOrFilter,
  exceptionStatusesIn,
  findingFromAnomaly,
  findingFromException,
  findingFromIncident,
  incidentStatusesIn,
  type AppSection,
  type FindingQueueState,
  type FindingKind,
  type FindingRow,
  type FuelExceptionKind,
  type UserRole,
} from "@silvicom/shared";
import { CASE_RULE_ID } from "@silvicom/shared";

/**
 * One inbox over two case tables (C7b).
 *
 * ── WHY THIS READS BOTH AND MERGES IN MEMORY ────────────────────────────────────────────────────
 * D-FX2 keeps the tables apart and C7a maps them onto one axis; somewhere the two have to meet, and
 * this is that place. A database view would be the other option and is refused for the reason D-FX2
 * gives: the two rows genuinely differ, and a view would have to null-pad one of them into the
 * other's shape, which is the flattening D-FUI7 forbids expressed in SQL instead of TypeScript.
 *
 * ⚠ THE COST IS BOUNDED AND MEASURED, NOT ASSUMED. Merging in memory means fetching before slicing,
 * so it is only honest while a carrier's whole finding set fits in one read. Measured 2026-09-06:
 * 82 open anomalies and 77 ledger rows, 159 in total. `READ_CAP` is 500 per source — comfortably
 * above that and comfortably below PostgREST's own 1,000-row ceiling, which silently truncates and
 * is the trap this repo has already paid for once. When a source hits the cap the response says so
 * in `truncated` rather than quietly showing a short list, because a queue that is missing rows and
 * does not say so is worse than one that refuses to load.
 */
const READ_CAP = 500;

export interface FindingsFilters {
  /** Queue states to include. Empty means every state. */
  states?: FindingQueueState[];
  /**
   * Finding kinds to include. Empty means every kind the caller may see.
   *
   * Applied per source rather than as one `in` clause, because the two tables spell a kind
   * differently: the ledger stores it in a `kind` column, and the anomaly feed has exactly one kind
   * and expresses it by being the anomaly feed. So a kind filter naming no anomaly kind skips that
   * table entirely rather than filtering it on a column it does not have.
   */
  kinds?: FindingKind[];
  /**
   * Vehicle IDS, which is what every other fuel surface sends (`useSpendFilters`). Resolved ONCE
   * here into the unit numbers the ledger stores and the ids the anomaly feed stores, because those
   * two tables disagree about how to name a truck and the caller should not have to know that.
   */
  vehicleIds?: string[] | null;
  from?: string | null;
  to?: string | null;
  assignedTo?: string | null;
  limit?: number;
  offset?: number;
}

export interface FindingsPage {
  rows: FindingRow[];
  total: number;
  /** True when a source hit `READ_CAP` and this page may be missing findings. */
  truncated: boolean;
}

/**
 * The sections this caller may see findings in.
 *
 * Q-FUI1's ruling made concrete: the inbox lives in Fuel and each kind carries its own section, so a
 * `safety` row is filtered out for anyone without `safety`. The accountant and the dispatcher see
 * policy findings; the safety manager sees theft cases; admin and fleet_manager see both. Derived
 * from the matrix — there is no list of roles here and there must never be one.
 */
export const visibleSections = (role: UserRole | null | undefined): AppSection[] =>
  FINDING_ASSIGNABLE_SECTIONS.filter((s) => canViewSection(role, s));

export async function readFindings(
  admin: SupabaseClient,
  orgId: string,
  role: UserRole | null | undefined,
  f: FindingsFilters = {},
): Promise<FindingsPage> {
  const sections = new Set(visibleSections(role));
  const states = f.states?.length ? f.states : (["open", "investigating", "working", "closed"] as FindingQueueState[]);

  // Each source is asked only for the statuses the requested queue states cover, translated through
  // C7a rather than restated here — which is the whole reason that module maps back as well as forth.
  const anomalyStatuses = [...new Set(states.flatMap((s) => anomalyStatusesIn(s)))];
  const exceptionStatuses = [...new Set(states.flatMap((s) => exceptionStatusesIn(s)))];
  const incidentStatuses = [...new Set(states.flatMap((s) => incidentStatusesIn(s)))];

  /*
   * ⚠ `anomalies` HAS NO `unit_number`. It carries `vehicle_id`, and the ledger carries the unit
   * string, because `fuel_exceptions.vehicle_id` has never been written by anything (P3 measured
   * this and resolved it the other way for that table). So a truck filter has to be translated for
   * one source, and translating it is not optional: silently ignoring `?trucks=` for half the inbox
   * would be the exact defect P3 closed — a filter the page writes, the URL keeps, and the data
   * ignores. One roster read serves both the filter and the unit label.
   */
  const fleet = f.vehicleIds?.length ? await fleetScope(admin, orgId, f.vehicleIds) : null;

  const wantsAnomalies = !f.kinds?.length || f.kinds.includes(CASE_RULE_ID as FindingKind);
  const wantsIncidents = !f.kinds?.length || f.kinds.includes(CARD_FRAUD_KIND as FindingKind);
  const exceptionKinds = (f.kinds ?? []).filter((k): k is FuelExceptionKind => k !== CASE_RULE_ID && k !== CARD_FRAUD_KIND);
  const wantsExceptions = !f.kinds?.length || exceptionKinds.length > 0;
  const readsCases = (wantsAnomalies && sections.has("safety")) || (wantsIncidents && sections.has("fuel"));
  const epoch = readsCases ? await detectionEpochOf(admin, orgId) : null;

  const [anomalies, exceptions, incidents] = await Promise.all([
    wantsAnomalies && sections.has("safety") && anomalyStatuses.length
      ? readAnomalies(admin, orgId, anomalyStatuses, f, fleet, epoch)
      : Promise.resolve([]),
    wantsExceptions && sections.has("fuel") && exceptionStatuses.length
      ? readExceptions(admin, orgId, exceptionStatuses, f, fleet, exceptionKinds)
      : Promise.resolve([]),
    wantsIncidents && sections.has("fuel") && incidentStatuses.length
      ? readIncidents(admin, orgId, incidentStatuses, f, fleet, epoch)
      : Promise.resolve([]),
  ]);

  const merged = [...anomalies, ...exceptions, ...incidents].sort(byOccurredDesc);
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const offset = Math.max(f.offset ?? 0, 0);
  return {
    rows: merged.slice(offset, offset + limit),
    total: merged.length,
    truncated: anomalies.length >= READ_CAP || exceptions.length >= READ_CAP || incidents.length >= READ_CAP,
  };
}

/**
 * The org's detection start date (D-CF9, 0439), or null. The inbox applies the one shared rule
 * (`detectionEpoch.ts`) to both case sources: a case before the start date is not listed unless a person
 * is investigating it. For a fill case that only matters in the closed view, because the reset closed
 * every earlier open one; for a card-fraud incident it is the rule that keeps the history CF2 records as
 * the nightly sweep re-scores old fills (#1358) out of today's queue — 5c said "the epoch decides what is
 * shown and told", and this is the shown half.
 */
async function detectionEpochOf(admin: SupabaseClient, orgId: string): Promise<string | null> {
  const { data } = await admin.from("organizations").select("detection_epoch").eq("id", orgId).maybeSingle();
  return ((data as { detection_epoch?: string | null } | null)?.detection_epoch) ?? null;
}

/**
 * One truck filter, in both vocabularies.
 *
 * Resolved against the caller's OWN roster, so a hand-edited id cannot name another org's vehicle —
 * the same rule `unitsForVehicles` follows for the ledger's own route.
 */
export async function fleetScope(
  admin: SupabaseClient,
  orgId: string,
  vehicleIds: string[],
): Promise<{ ids: string[]; units: string[]; unitOf: Map<string, string> }> {
  const { data } = await admin
    .from("vehicles")
    .select("id, unit_number")
    .eq("org_id", orgId)
    .in("id", vehicleIds);
  const rows = (data ?? []) as { id: string; unit_number: string | null }[];
  return {
    ids: rows.map((v) => v.id),
    units: rows.map((v) => v.unit_number).filter((u): u is string => Boolean(u)),
    unitOf: new Map(rows.filter((v) => v.unit_number).map((v) => [v.id, v.unit_number as string])),
  };
}

async function readAnomalies(
  admin: SupabaseClient,
  orgId: string,
  statuses: string[],
  f: FindingsFilters,
  fleet: { ids: string[]; unitOf: Map<string, string> } | null,
  epoch: string | null,
): Promise<FindingRow[]> {
  // A truck filter that matched no vehicle of this org must return nothing, not everything.
  if (fleet && fleet.ids.length === 0) return [];
  let q = admin
    .from("anomalies")
    // The service role bypasses RLS; this query carries its own tenant scope.
    .select("id, status, disposition, message, fueled_at, created_at, assigned_to, vehicle_id")
    .eq("org_id", orgId)
    .in("status", statuses);
  if (fleet) q = q.in("vehicle_id", fleet.ids);
  if (f.assignedTo) q = q.eq("assigned_to", f.assignedTo);
  // ⚠ `fueled_at` and not a business date — Q-FUI13 (b). Filtering the two sources on dates that mean
  // slightly different things is a known and recorded inconsistency, not one introduced here.
  if (f.from) q = q.gte("fueled_at", f.from);
  if (f.to) q = q.lte("fueled_at", `${f.to}T23:59:59.999Z`);
  const afterReset = detectionEpochOrFilter(epoch);
  if (afterReset) q = q.or(afterReset);
  const { data } = await q.order("fueled_at", { ascending: false }).limit(READ_CAP);
  const rows = (data ?? []) as (Parameters<typeof findingFromAnomaly>[0] & { vehicle_id?: string | null })[];
  return rows.map((r) => findingFromAnomaly({ ...r, unit_number: unitFor(r.vehicle_id, fleet) }));
}

async function readExceptions(
  admin: SupabaseClient,
  orgId: string,
  statuses: string[],
  f: FindingsFilters,
  fleet: { units: string[] } | null,
  kinds: FuelExceptionKind[],
): Promise<FindingRow[]> {
  // Same rule as the anomaly side: a truck filter matching no vehicle returns nothing, not everything.
  if (fleet && fleet.units.length === 0) return [];
  let q = admin
    .from("fuel_exceptions")
    .select("id, kind, status, occurred_on, amount, credited_amount, unit_number, assigned_to, first_seen_at")
    .eq("org_id", orgId)
    .in("status", statuses);
  if (f.assignedTo) q = q.eq("assigned_to", f.assignedTo);
  if (fleet) q = q.in("unit_number", fleet.units);
  if (kinds.length) q = q.in("kind", kinds);
  if (f.from) q = q.gte("occurred_on", f.from);
  if (f.to) q = q.lte("occurred_on", f.to);
  const { data } = await q.order("occurred_on", { ascending: false }).limit(READ_CAP);
  return ((data ?? []) as Parameters<typeof findingFromException>[0][]).map(findingFromException);
}

/**
 * Card-fraud incidents (CF2, 0438), section fuel (Q-F11 (a)). Dated by when the incident OPENED, the
 * first attempt, so the date filter and the age read the same moment. A truck filter matches the card's
 * truck (`vehicle_id`), as it matches a fill case's.
 */
async function readIncidents(
  admin: SupabaseClient,
  orgId: string,
  statuses: string[],
  f: FindingsFilters,
  fleet: { ids: string[]; unitOf: Map<string, string> } | null,
  epoch: string | null,
): Promise<FindingRow[]> {
  if (fleet && fleet.ids.length === 0) return [];
  let q = admin
    .from("card_fraud_incidents")
    .select("id, status, disposition, card_ref, opened_at, attempt_count, fuel_taken, places, assigned_to, vehicle_id")
    .eq("org_id", orgId)
    .in("status", statuses);
  if (fleet) q = q.in("vehicle_id", fleet.ids);
  if (f.assignedTo) q = q.eq("assigned_to", f.assignedTo);
  if (f.from) q = q.gte("opened_at", f.from);
  if (f.to) q = q.lte("opened_at", `${f.to}T23:59:59.999Z`);
  const afterReset = detectionEpochOrFilter(epoch, "opened_at");
  if (afterReset) q = q.or(afterReset);
  const { data } = await q.order("opened_at", { ascending: false }).limit(READ_CAP);
  const rows = (data ?? []) as (Parameters<typeof findingFromIncident>[0] & { vehicle_id?: string | null })[];
  return rows.map((r) => findingFromIncident({ ...r, unit_number: unitFor(r.vehicle_id, fleet) }));
}

/**
 * The unit a theft case is about, when we already know it.
 *
 * Null unless a truck filter was applied, and deliberately so: labelling every anomaly would mean
 * reading the whole roster on every unfiltered page load to fill a column, and this read exists to be
 * cheap. The page shows the unit when it scoped to one and leaves it blank otherwise, which is
 * honest; C7b's surface merge can decide whether the column is worth a roster read.
 */
const unitFor = (
  vehicleId: string | null | undefined,
  fleet: { unitOf: Map<string, string> } | null,
): string | null => (vehicleId && fleet ? (fleet.unitOf.get(vehicleId) ?? null) : null);

/**
 * The two figures the Dashboard's fuel strip carries (C9's ledger half).
 *
 * ── WHY NOT `exceptionTotals`, WHICH ALREADY COMPUTES `recovered` ───────────────────────────────
 * Because of where this renders. `exceptionTotals` fetches every matching row and sums in memory,
 * which is right above a table somebody is already reading and wrong on the landing page every
 * authenticated member opens — that is Q-SAM8's whole finding, which refused `readTelematicsCoverage`
 * on this exact screen for this exact reason and replaced it with a count.
 *
 * So the open figure is two `head` counts, indexed, issued concurrently. The money figure DOES read
 * rows, and the population it reads is bounded by two conditions rather than by history: credited,
 * and within one quarter. A carrier recovering money on a hundred findings a quarter would be a
 * carrier the product had transformed; today it is zero. If that ever stops being true the answer is
 * a SQL sum, not a bigger fetch.
 *
 * ── AND WHY THE MONEY HALF ASKS NO SECTION QUESTION ─────────────────────────────────────────────
 * `recovered` is money, and D-FUI7 gives an anomaly none — so it can only ever come from the ledger,
 * and `fuel` is the only section that could gate it. A caller without `fuel` gets null rather than
 * zero: they are not being told the fleet recovered nothing, they are being told nothing.
 */
export interface FindingsSummary {
  /** Open, investigating or with the vendor — across the sections this caller may see. Null for none. */
  open: number | null;
  /** Credited back this quarter, in dollars. Null when the caller cannot see the money ledger. */
  recoveredThisQuarter: number | null;
  /** The first day of the quarter the figure covers, so the tile can say which one. */
  quarterFrom: string;
  /**
   * The date of the oldest item `open` counts (YYYY-MM-DD, each source's own date column), or null when
   * it counts none. Q-F13 (a), ruled 2026-10-08: the Dashboard's door to Fuel problems carries it as
   * `?from=`, so the page lists the same items the tile counted. The page reads a date window (90 days
   * unless the link names one) and the tile counts every open item; without this the two agreed only
   * while nothing open was older than 90 days.
   */
  oldestOpenOn: string | null;
}

/** First day of the calendar quarter containing `now`, in UTC — the same basis every stored date uses. */
export function quarterStart(now: Date): string {
  const q = Math.floor(now.getUTCMonth() / 3) * 3;
  return `${now.getUTCFullYear()}-${String(q + 1).padStart(2, "0")}-01`;
}

export async function readFindingsSummary(
  admin: SupabaseClient,
  orgId: string,
  role: UserRole | null | undefined,
  now: Date = new Date(),
): Promise<FindingsSummary> {
  const sections = new Set(visibleSections(role));
  const from = quarterStart(now);
  // The queue states that mean "somebody still has to do something", translated per source through
  // C7a rather than restated — the same reason `readFindings` asks it that way.
  const openStates: FindingQueueState[] = ["open", "investigating", "working"];
  const anomalyOpen = [...new Set(openStates.flatMap((s) => anomalyStatusesIn(s)))];
  const exceptionOpen = [...new Set(openStates.flatMap((s) => exceptionStatusesIn(s)))];
  const incidentOpen = [...new Set(openStates.flatMap((s) => incidentStatusesIn(s)))];
  /*
   * The same start-date rule as the list, for BOTH case sources, so the count equals the rows the queue
   * shows (8c accept). ⚠ Until 8c4 only incidents had it: an open fill case dated before the start date
   * was counted here and hidden there. The reset closed every such case, so the two agreed in practice,
   * but the nightly sweep re-scores history (#1358) and a case it opens on an old fill made the Dashboard
   * one higher than the page it links to.
   * Pinned by "asks every table the same question as the queue, for every role" in findingsSummary.test.ts.
   */
  const readsCases = sections.has("fuel") || sections.has("safety");
  const epoch = readsCases ? await detectionEpochOf(admin, orgId) : null;

  const [anomalies, exceptions, credited, incidents] = await Promise.all([
    sections.has("safety")
      ? countFromEpoch(
          admin.from("anomalies").select("fueled_at", { count: "exact" }).eq("org_id", orgId).in("status", anomalyOpen),
          detectionEpochOrFilter(epoch),
          "fueled_at",
        )
      : Promise.resolve({ count: null }),
    sections.has("fuel")
      ? countFromEpoch(
          admin.from("fuel_exceptions").select("occurred_on", { count: "exact" }).eq("org_id", orgId).in("status", exceptionOpen),
          null,
          "occurred_on",
        )
      : Promise.resolve({ count: null }),
    sections.has("fuel")
      ? admin
          .from("fuel_exceptions")
          .select("credited_amount")
          .eq("org_id", orgId)
          .eq("status", "credited")
          .gte("credited_on", from)
      : Promise.resolve({ data: null }),
    sections.has("fuel")
      ? countFromEpoch(
          admin.from("card_fraud_incidents").select("opened_at", { count: "exact" }).eq("org_id", orgId).in("status", incidentOpen),
          detectionEpochOrFilter(epoch, "opened_at"),
          "opened_at",
        )
      : Promise.resolve({ count: null }),
  ]);

  const counts = [anomalies.count, exceptions.count, incidents.count].filter((c): c is number => typeof c === "number");
  const oldest = [anomalies, exceptions, incidents]
    .map((r) => ("oldestOn" in r ? r.oldestOn : null))
    .filter((d): d is string => d != null)
    .sort()[0] ?? null;
  const rows = (credited as { data: { credited_amount: number | string | null }[] | null }).data;
  return {
    // Null and not zero when the caller may see neither: "no findings you may see" is not "no findings".
    open: counts.length ? counts.reduce((a, b) => a + b, 0) : null,
    recoveredThisQuarter: rows == null ? null : rows.reduce((sum, r) => sum + (Number(r.credited_amount) || 0), 0),
    quarterFrom: from,
    oldestOpenOn: oldest,
  };
}

/**
 * An open count on the start-date rule, and the date of the oldest row it counts, in ONE read: ordered by
 * the source's date, one row returned, and PostgREST's exact count is over the whole match, not the page.
 * The date is the UTC day, which is the day the queue's own date filter compares on. The table stays a
 * literal at the caller (`lint:boundaries`' table access).
 */
async function countFromEpoch<Q extends { or: (filter: string) => Q; order: (col: string, o: { ascending: boolean }) => Q; limit: (n: number) => Q }>(
  q: Q,
  afterReset: string | null,
  dateColumn: string,
): Promise<{ count: number | null; oldestOn: string | null }> {
  const scoped = afterReset ? q.or(afterReset) : q;
  const r = (await scoped.order(dateColumn, { ascending: true }).limit(1)) as unknown as {
    count: number | null;
    data: Record<string, unknown>[] | null;
  };
  const first = r.data?.[0]?.[dateColumn];
  return { count: r.count ?? null, oldestOn: typeof first === "string" ? first.slice(0, 10) : null };
}
