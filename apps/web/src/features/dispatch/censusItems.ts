import type { DispatchBoardResponse, DispatchBoardRow } from "@silvicom/shared";
import { NO_FLEET_OPTION, NO_TRUCK_OPTION, POOL_FLEET, POOL_OPTION, dispatcherName, type ScopeChoice } from "./dispatchScope";
import { fleetCensus } from "./dispatchBoardView";

/**
 * The Dispatcher choice (DISPATCH-BOARD-V2-PLAN D-DBV2, Q-DBV8, Q-DBV9), for both dispatch pages. Each
 * entry is a count and the filter that count is of, so choosing it shows exactly that many rows. What is
 * counted is the page's own row: TRUCKS on the board, LOADS on the Loads page.
 *
 * Q-DBV9 (owner, 2026-10-16): the entries were a strip of buttons above the table, and "cards with
 * dispatcher names is not the right UI" — sixteen of them were a second toolbar. They are one select
 * in the filter row now (`censusSelectOptions`), the first filter, with the same counts in its labels.
 *
 * Q-DBV8 (ruled 2026-10-16, "proceed as proposed"): Loads does not borrow the board's truck counts — a
 * chip saying 15 above a list of 9 loads is the disagreement D-DBV2 exists to prevent — it counts its
 * own list with the same strip.
 */
export interface CensusPick {
  scope: ScopeChoice;
  fleet: string;
}
export interface CensusItem {
  key: string;
  label: string;
  /** Who runs the fleet, when an office linked it and the name says more than the code. */
  owner: string | null;
  count: number;
  /** The board's second figure ("6 empty"); null where the page has none. */
  sub: number | null;
  /** What the second figure counts, for the button's name: "empty now". */
  subWords: string | null;
  pick: CensusPick;
  pressed: boolean;
}

type Board = Pick<DispatchBoardResponse, "fleets" | "dispatchers" | "rows"> | null | undefined;

/** The working fleets the board knows, sorted — the same buttons on both pages, whatever the tab. */
function fleetCodes(board: Board): string[] {
  return [...new Set((board?.rows ?? []).map((r) => r.fleetCode))].filter((c): c is string => c != null && c !== POOL_FLEET).sort();
}

function ownerOf(code: string, board: Board): string | null {
  const linked = board?.fleets.find((f) => f.code === code)?.dispatcherId ?? null;
  const name = linked ? dispatcherName(linked, board?.dispatchers ?? []) : null;
  return name && name.toLowerCase() !== code.toLowerCase() ? name : null;
}

const item = (key: string, label: string, pick: CensusPick, pressed: boolean, count: number, sub: number | null = null, subWords: string | null = null, owner: string | null = null): CensusItem =>
  ({ key, label, owner, count, sub, subWords, pick, pressed });

/**
 * The board's choice: trucks per fleet, and how many of them are empty now — the figure a dispatcher
 * plans the morning from. Counted over the rows every OTHER filter admits (`rowsBeforeScope`), so the
 * number beside a fleet is the rows choosing it shows.
 * "Mine" (fleet ∪ loads I dispatch, D-DB1) leads for a caller linked to a McLeod login; the parked pool
 * and trucks with no fleet close the list, each only when it has trucks.
 */
export function truckCensusItems(rows: readonly DispatchBoardRow[], mineCount: number | null, board: Board, choice: ScopeChoice, fleet: string): CensusItem[] {
  const census = fleetCensus(rows);
  const working = rows.filter((r) => r.fleetCode !== POOL_FLEET);
  const none = !fleet;
  const out: CensusItem[] = [];
  if (mineCount != null) out.push(item("mine", "Mine", { scope: "mine", fleet: "" }, none && choice === "mine", mineCount));
  out.push(item("all", "All", { scope: "all", fleet: "" }, none && choice === "all", working.length, working.filter((r) => r.flags.emptyNow).length, "empty now"));
  // Every working fleet is listed, at 0 when the other filters leave it none, so the select does not
  // change shape as State or Free narrow the board — as the Loads page's does.
  for (const code of fleetCodes(board)) {
    const c = census.get(code) ?? { trucks: 0, empty: 0 };
    out.push(item(code, code, { scope: "all", fleet: code }, fleet === code, c.trucks, c.empty, "empty now", ownerOf(code, board)));
  }
  const pool = census.get(POOL_FLEET);
  if (pool) out.push(item(POOL_OPTION, "Pool", { scope: "all", fleet: POOL_OPTION }, fleet === POOL_OPTION, pool.trucks));
  const unfleeted = census.get(null);
  if (unfleeted) out.push(item(NO_FLEET_OPTION, "No fleet", { scope: "all", fleet: NO_FLEET_OPTION }, fleet === NO_FLEET_OPTION, unfleeted.trucks));
  return out;
}

/**
 * The Loads page's choice: the loads its list holds right now — this tab, this type, this search — per
 * fleet of the truck they are on. Each count is `admits` run over those loads with the button's own
 * choice, the very test the table runs, so the two cannot disagree (the Uncovered exemption from My
 * fleet included). Every working fleet the board knows gets a button even at 0, so the strip does not
 * shift under the reader between tabs; Pool, No fleet and No truck (a load with no truck yet) close it
 * only when they hold loads.
 */
export function loadCensusItems<T>(
  entries: readonly T[],
  admits: (entry: T, pick: { mine: boolean; fleet: string }) => boolean,
  linked: boolean,
  board: Board,
  choice: ScopeChoice,
  fleet: string,
): CensusItem[] {
  const count = (pick: CensusPick) => entries.filter((e) => admits(e, { mine: pick.scope === "mine", fleet: pick.fleet })).length;
  const none = !fleet;
  const at = (key: string, label: string, pick: CensusPick, pressed: boolean, owner: string | null = null) => item(key, label, pick, pressed, count(pick), null, null, owner);
  const out: CensusItem[] = [];
  if (linked) out.push(at("mine", "Mine", { scope: "mine", fleet: "" }, none && choice === "mine"));
  out.push(at("all", "All", { scope: "all", fleet: "" }, none && choice === "all"));
  for (const code of fleetCodes(board)) out.push(at(code, code, { scope: "all", fleet: code }, fleet === code, ownerOf(code, board)));
  for (const [key, label] of [[POOL_OPTION, "Pool"], [NO_FLEET_OPTION, "No fleet"], [NO_TRUCK_OPTION, "No truck"]] as const) {
    const tail = at(key, label, { scope: "all", fleet: key }, fleet === key);
    if (tail.count > 0 || tail.pressed) out.push(tail);
  }
  return out;
}

/**
 * The choice as a select's options: "KANE · Kane Smith (15, 6 empty now)". All is the select's empty
 * value, as every FilterSelect's "no narrowing" is, so the trigger reads as a filter only when it is
 * one — Mine or a fleet — and its clear button returns to All.
 */
const ALL_KEY = "all";
const valueOf = (key: string) => (key === ALL_KEY ? "" : key);

export function censusSelectOptions(items: readonly CensusItem[]): { value: string; label: string }[] {
  return items.map((i) => ({
    value: valueOf(i.key),
    label: `${i.label}${i.owner ? ` · ${i.owner}` : ""} (${i.count.toLocaleString("en-US")}${i.sub != null ? `, ${i.sub} ${i.subWords}` : ""})`,
  }));
}

/** The entry in force, as the select's value: the pressed one, else All (""). */
export function censusValue(items: readonly CensusItem[]): string {
  return valueOf(items.find((i) => i.pressed)?.key ?? ALL_KEY);
}

/** What choosing `value` sets; null for a value no entry has (a stale option). */
export function pickOf(items: readonly CensusItem[], value: string): CensusPick | null {
  const key = value || ALL_KEY;
  return items.find((i) => i.key === key)?.pick ?? null;
}
