/**
 * The warning desk's lines (WARNING-DESK-PLAN WD4, D-WD6/D-WD12/D-WD15): `follow_ups` rows joined —
 * when the line is DRAWN — to the roster (unit number, who to call, their phone) and to the rule
 * catalogue (its label), with the two derived states computed then and never stored.
 *
 * The roster is read through its exported `readSamsaraSubjects` (D-ARC3); this module never selects a
 * roster table. Every query here is org-scoped: the API reads with the service role, which bypasses RLS.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  compareFollowUps,
  looksFixed,
  warnedAfterContact,
  type FollowUpCategory,
  type FollowUpLine,
  type FollowUpOutcome,
  type FollowUpRule,
  type FollowUpSeverity,
  type FollowUpStatus,
  type WarningSubject,
} from "@silvicom/shared";
import type { SamsaraSubjects } from "../roster/index.js";

export interface FollowUpRow {
  id: string;
  rule_key: string;
  category: FollowUpCategory;
  severity: FollowUpSeverity;
  subject_kind: WarningSubject;
  subject_samsara_id: string;
  subject_name: string | null;
  driver_samsara_id: string | null;
  driver_name: string | null;
  status: FollowUpStatus;
  outcome: FollowUpOutcome | null;
  warning_count: number;
  active_count: number;
  first_at: string;
  last_at: string;
  contacted_at: string | null;
  closed_at: string | null;
  assignee_id: string | null;
  version: number;
}

export const FOLLOW_UP_COLUMNS =
  "id, rule_key, category, severity, subject_kind, subject_samsara_id, subject_name, driver_samsara_id, driver_name, status, outcome, " +
  "warning_count, active_count, first_at, last_at, contacted_at, closed_at, assignee_id, version";

/** The Closed filter's length: a desk looks back over the last few weeks, not the year. */
export const CLOSED_LIMIT = 200;
/** An open desk is ~22 new lines a working day (plan §1.6); this is a guard, not a page size. */
const OPEN_LIMIT = 2000;

export interface ListFilter {
  categories: readonly FollowUpCategory[];
  closed: boolean;
  mineOf: string | null;
}

export async function readFollowUpRows(admin: SupabaseClient, orgId: string, f: ListFilter): Promise<FollowUpRow[]> {
  if (f.categories.length === 0) return [];
  let q = admin.from("follow_ups").select(FOLLOW_UP_COLUMNS).eq("org_id", orgId).in("category", [...f.categories]);
  q = f.closed ? q.eq("status", "closed") : q.neq("status", "closed");
  if (f.mineOf) q = q.eq("assignee_id", f.mineOf);
  const { data, error } = await (f.closed ? q.order("closed_at", { ascending: false }).limit(CLOSED_LIMIT) : q.limit(OPEN_LIMIT));
  if (error) throw new Error(`follow_ups list: ${error.message}`);
  return (data ?? []) as unknown as FollowUpRow[];
}

/** Open follow-ups per category, for the tab badges — the caller's visible categories only. */
export async function countOpenByCategory(
  admin: SupabaseClient,
  orgId: string,
  categories: readonly FollowUpCategory[],
): Promise<Record<FollowUpCategory, number>> {
  const counts: Record<FollowUpCategory, number> = { maintenance: 0, safety: 0, compliance: 0, route: 0 };
  if (categories.length === 0) return counts;
  const { data, error } = await admin
    .from("follow_ups")
    .select("category")
    .eq("org_id", orgId)
    .neq("status", "closed")
    .in("category", [...categories])
    .limit(OPEN_LIMIT);
  if (error) throw new Error(`follow_ups counts: ${error.message}`);
  for (const r of (data ?? []) as { category: FollowUpCategory }[]) counts[r.category] += 1;
  return counts;
}

export async function readFollowUpRow(admin: SupabaseClient, orgId: string, id: string): Promise<FollowUpRow | null> {
  const { data, error } = await admin.from("follow_ups").select(FOLLOW_UP_COLUMNS).eq("org_id", orgId).eq("id", id).maybeSingle();
  if (error) throw new Error(`follow_ups read: ${error.message}`);
  return (data as unknown as FollowUpRow | null) ?? null;
}

/** The Samsara ids a set of lines needs the roster to resolve. */
export function subjectIdsOf(rows: readonly FollowUpRow[]): { vehicleSamsaraIds: string[]; trailerSamsaraIds: string[]; driverSamsaraIds: string[] } {
  const vehicles = new Set<string>();
  const trailers = new Set<string>();
  const drivers = new Set<string>();
  for (const r of rows) {
    if (r.subject_kind === "truck") vehicles.add(r.subject_samsara_id);
    if (r.subject_kind === "trailer") trailers.add(r.subject_samsara_id);
    if (r.subject_kind === "driver") drivers.add(r.subject_samsara_id);
    if (r.driver_samsara_id) drivers.add(r.driver_samsara_id);
  }
  return { vehicleSamsaraIds: [...vehicles], trailerSamsaraIds: [...trailers], driverSamsaraIds: [...drivers] };
}

/**
 * Who the line says to call (D-WD15), and which record said so.
 *  · a driver's problem — that driver;
 *  · a truck's — the driver Samsara has on the truck NOW, else the one Samsara named on the warning;
 *  · a trailer's — the truck it is paired with now, then that truck's driver ("trailer pairing").
 * A Samsara name the roster cannot match is still shown, with no phone — never a guess dressed as a fact.
 */
function whoToCall(r: FollowUpRow, s: SamsaraSubjects): Pick<FollowUpLine, "truck" | "trailer" | "driver" | "inRoster"> {
  if (r.subject_kind === "driver") {
    const d = s.driversBySamsaraId.get(r.subject_samsara_id);
    return {
      inRoster: !!d,
      truck: null,
      trailer: null,
      driver: d
        ? { id: d.id, name: d.name, phone: d.phone, source: "samsara" }
        : r.subject_name || r.driver_name
          ? { id: null, name: (r.subject_name ?? r.driver_name)!, phone: null, source: "samsara" }
          : null,
    };
  }
  const trailer = r.subject_kind === "trailer" ? s.trailersBySamsaraId.get(r.subject_samsara_id) : undefined;
  const truck = r.subject_kind === "truck" ? s.trucksBySamsaraId.get(r.subject_samsara_id) : trailer?.vehicleId ? s.trucksById.get(trailer.vehicleId) : undefined;
  const holder = truck?.driverId ? s.driversById.get(truck.driverId) : undefined;
  const named = r.driver_samsara_id ? s.driversBySamsaraId.get(r.driver_samsara_id) : undefined;
  const source = r.subject_kind === "trailer" ? ("trailer_pairing" as const) : ("samsara" as const);
  let driver: FollowUpLine["driver"] = null;
  if (holder) driver = { id: holder.id, name: holder.name, phone: holder.phone, source };
  else if (r.subject_kind === "truck" && named) driver = { id: named.id, name: named.name, phone: named.phone, source: "samsara" };
  else if (r.subject_kind === "truck" && r.driver_name) driver = { id: null, name: r.driver_name, phone: null, source: "samsara" };
  return {
    inRoster: r.subject_kind === "trailer" ? !!trailer : !!truck,
    truck: truck ? { id: truck.id, number: truck.unitNumber } : null,
    trailer: r.subject_kind === "trailer" ? { id: trailer?.id ?? null, number: trailer?.unitNumber ?? r.subject_name ?? "Trailer" } : null,
    driver,
  };
}

export function toLine(r: FollowUpRow, rules: ReadonlyMap<string, FollowUpRule>, s: SamsaraSubjects, callerId: string, nowMs: number): FollowUpLine {
  const rule = rules.get(r.rule_key);
  const firstAt = new Date(Date.parse(r.first_at)).toISOString();
  const lastAt = new Date(Date.parse(r.last_at)).toISOString();
  const open = r.status !== "closed";
  return {
    id: r.id,
    ruleKey: r.rule_key,
    // A rule Samsara no longer lists (its configuration deleted) keeps its lines readable.
    ruleLabel: rule?.label ?? "Samsara alert",
    windowDays: rule?.windowDays ?? 7,
    category: r.category,
    severity: r.severity,
    status: r.status,
    outcome: r.outcome,
    subjectKind: r.subject_kind,
    subjectName: r.subject_name,
    ...whoToCall(r, s),
    warningCount: r.warning_count,
    firstAt,
    lastAt,
    contactedAt: r.contacted_at ? new Date(Date.parse(r.contacted_at)).toISOString() : null,
    closedAt: r.closed_at ? new Date(Date.parse(r.closed_at)).toISOString() : null,
    mine: r.assignee_id === callerId,
    looksFixed: open && looksFixed(r.active_count, lastAt, nowMs),
    warnedAgain: open && warnedAfterContact(lastAt, r.contacted_at),
    version: r.version,
  };
}

export function sortLines(lines: FollowUpLine[]): FollowUpLine[] {
  return lines.sort(compareFollowUps);
}
