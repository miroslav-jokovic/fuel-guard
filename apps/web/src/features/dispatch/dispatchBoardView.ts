import { legalDriveMs, needsAttention, type DispatchBoardRow, type DispatchScope } from "@silvicom/shared";
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

