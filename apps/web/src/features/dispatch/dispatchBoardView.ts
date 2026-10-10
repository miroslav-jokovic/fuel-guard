import { legalDriveMs, needsAttention, type DispatchBoardRow, type DispatchScope } from "@silvicom/shared";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import { POOL_FLEET, admitsScope, type ScopeFilter } from "./dispatchScope";

export { NO_FLEET_OPTION, POOL_FLEET, POOL_OPTION, dispatcherName } from "./dispatchScope";

/**
 * How the dispatch board page narrows and words its rows (DISPATCH-BOARD-PLAN §5). Every VERDICT on a
 * row is the server's (`@silvicom/shared` `dispatchBoard.ts`); this file only decides which rows to
 * show and how to say a number, so it can be tested without rendering a table.
 */

/** The exception queues (plan §4 #5) — each a predicate over the server's flags, defined once. */
export const BOARD_QUEUES = [
  { value: "all", label: "All trucks", test: () => true },
  { value: "attention", label: "Needs attention", test: (r: DispatchBoardRow) => needsAttention(r.flags) },
  { value: "late", label: "Late risk", test: (r: DispatchBoardRow) => r.flags.lateRisk },
  { value: "no-next", label: "No next load", test: (r: DispatchBoardRow) => r.flags.noNextLoad },
  { value: "empty", label: "Empty now", test: (r: DispatchBoardRow) => r.flags.emptyNow },
  { value: "hos-low", label: "HOS low", test: (r: DispatchBoardRow) => r.flags.hosLow },
  { value: "no-gps", label: "No GPS", test: (r: DispatchBoardRow) => r.flags.noGps },
] as const;
export type BoardQueue = (typeof BOARD_QUEUES)[number]["value"];

export interface BoardFilter extends ScopeFilter {
  queue: BoardQueue;
  search: string;
}

/** The rows a filter admits, in the order given. */
export function filterBoard(rows: readonly DispatchBoardRow[], scope: DispatchScope, f: BoardFilter): DispatchBoardRow[] {
  const queue = BOARD_QUEUES.find((q) => q.value === f.queue) ?? BOARD_QUEUES[0];
  const term = f.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (!admitsScope(r, scope, f)) return false;
    // "All" still leaves the parked pool out unless it is asked for by name. A board rule, not a scope
    // rule: a truck parked in the shop is not work, but a load on the Loads page is a record and stays.
    if (!f.mine && !f.fleet && r.fleetCode === POOL_FLEET) return false;
    if (!queue.test(r)) return false;
    if (!term) return true;
    return [r.unitNumber, r.driver?.name, r.current?.ref, r.current?.customerName, r.position?.place, r.current?.nextStop?.city, r.next?.ref]
      .filter((v): v is string => Boolean(v))
      .some((v) => v.toLowerCase().includes(term));
  });
}

/**
 * Widths are budgeted to fit the table's 1104 px at a 1440 px screen with the sidebar open — measured
 * 2026-10-10 in the browser, when the first cut (every column at its content's natural width, no
 * wrapping) came to 1664 px and pushed On time, Empties and Next load off the right edge: the three
 * columns the board exists for (§5) were the three nobody saw without scrolling. Every cell is
 * already a two-line stack, so cells wrap (`:nowrap="false"`) rather than widen — except a timestamp, which breaks
 * only between "by" and its date, never inside "10:59 AM" — and the attention
 * dot rides in front of the unit number (still the row's left edge) instead of spending a 4rem column
 * on an 8 px dot. Narrower screens scroll with the truck pinned, as §5 asks.
 *
 * HOS is ONE cell — the binding clock and the duty status beneath it — rather than the status under
 * the driver's name and the time in a column of its own: both answer "can this driver take a load",
 * and split, the badge read as a fact about the person. Every column sorts, by the quantity its words
 * describe (`boardSortValue`), so On time can put the late trucks first (owner, 2026-10-10).
 */
export const BOARD_COLUMNS: DataTableColumn[] = [
  { key: "unit", label: "Truck", width: "sm", sortable: true, cellClass: "font-medium text-ink" },
  { key: "driver", label: "Driver", width: "md", sortable: true },
  { key: "hos", label: "HOS", width: "sm", sortable: true },
  { key: "now", label: "Now", width: "md", sortable: true },
  { key: "load", label: "Current load", width: "md", sortable: true },
  { key: "nextStop", label: "Next stop", width: "md", sortable: true },
  { key: "onTime", label: "On time", width: "sm", sortable: true },
  { key: "empties", label: "Empties", width: "md", sortable: true },
  { key: "next", label: "Next load", width: "sm", sortable: true },
];

/** The column keys a `?sort=` link may name — derived, so a new sortable column cannot be forgotten. */
export const BOARD_SORT_KEYS = BOARD_COLUMNS.filter((c) => c.sortable).map((c) => c.key);

/**
 * What each board column sorts by (`sortRows` accessor). A cell shows words; it sorts by the quantity
 * the words describe — drive time left, the stop's appointment, when the truck empties — so "2h 05m"
 * sorts below "10h 00m" and "Thu 10/09" before "Fri 10/10".
 *
 * On time sorts worst first: late, at risk, on time, and no verdict last, because the reason to sort
 * that column is to bring the trucks that will miss their appointment to the top.
 */
const ON_TIME_RANK: Record<string, number> = { late: 0, at_risk: 1, on_time: 2 };
export function boardSortValue(r: DispatchBoardRow, key: string): unknown {
  switch (key) {
    case "unit":
      return r.unitNumber;
    case "driver":
      return r.driver?.name ?? r.current?.driverName ?? null;
    case "hos":
      return legalDriveLeft(r);
    case "now":
      return r.position?.place ?? null;
    case "load":
      return r.current?.ref ?? null;
    case "nextStop":
      return r.current?.nextStop?.appointmentEnd ?? r.current?.nextStop?.appointmentStart ?? null;
    case "onTime":
      return r.current ? (ON_TIME_RANK[r.onTime] ?? null) : null;
    case "empties":
      return r.empties?.at ?? null;
    case "next":
      return r.next?.ref ?? null;
    default:
      return null;
  }
}

/** "5h 12m", "45m", or "—". */
export function durationWords(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const mins = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** The binding clock, the one that ends the driver's day first — the number a dispatcher plans with. */
export function legalDriveLeft(r: DispatchBoardRow): number | null {
  return r.hos ? legalDriveMs({ ...r.hos, timeUntilBreakMs: r.hos.breakRemainingMs }) : null;
}

/** How old the GPS fix is, in the words the board uses: "now", "4 min", "3 h", "2 d". */
export function gpsAgeWords(seconds: number | null | undefined): string {
  if (seconds == null) return "no fix";
  if (seconds < 90) return "now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86_400)} d`;
}

/** "Indianapolis, IN" from a stop's parts, or the place name when the city is missing. */
export function stopPlace(s: { city: string | null; state: string | null; name: string | null } | null | undefined): string {
  if (!s) return "";
  return [s.city, s.state].filter(Boolean).join(", ") || s.name || "";
}

