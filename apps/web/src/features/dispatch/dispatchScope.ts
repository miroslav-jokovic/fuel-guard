import { computed, type Ref } from "vue";
import { dispatcherLabel, inMyScope, type DispatchBoardResponse, type DispatchScope } from "@silvicom/shared";
import type { UrlQueryState } from "@silvicom/ui";

/**
 * Whose work a list shows — My fleet · All, Fleet, Dispatched by — for BOTH dispatch pages
 * (DISPATCH-BOARD-PLAN §5.3 point 1, DB5b). One definition so "my fleet" can never mean two things:
 * the Dispatch board narrows trucks with it, the Loads page narrows loads with it, and each hands it
 * the same shape — the truck's fleet and the dispatchers on the load(s) it concerns.
 *
 * "Mine" itself is `inMyScope` in `@silvicom/shared` (D-DB1: a truck in a fleet my login runs, OR a load
 * my login dispatches). The fleet list, the dispatcher roster and the caller's own scope all come from
 * the board's response, the one place the API composes them; the Loads page reads that same query
 * rather than a second copy of the links.
 */

/** Fleet code '1' is the parked and shop pool (Q-DB2): off the default board, one choice away. */
export const POOL_FLEET = "1";
export const POOL_OPTION = "__pool__";
export const NO_FLEET_OPTION = "__none__";
/**
 * Loads only: a load with no truck yet (Q-DBV8). Its fleet is unknown for a different reason from a
 * truck's with no fleet code, and the Loads census names the two apart; the board never sees one.
 */
export const NO_TRUCK_OPTION = "__no_truck__";

export interface ScopeFilter {
  mine: boolean;
  fleet: string;
  dispatcher: string;
}

/** What scope is judged on: the truck's fleet, and the dispatcher of each load in question. */
export interface ScopedItem {
  fleetCode: string | null;
  /** False for a load with no truck; absent on a board row, which is always a truck. */
  hasTruck?: boolean;
  current: { dispatcherId: string | null } | null;
  next: { dispatcherId: string | null } | null;
}

/** Does the My fleet / Fleet / Dispatched-by choice admit this item? */
export function admitsScope(item: ScopedItem, scope: DispatchScope, f: ScopeFilter): boolean {
  if (f.mine && !inMyScope(item, scope)) return false;
  if (f.fleet === POOL_OPTION && item.fleetCode !== POOL_FLEET) return false;
  if (f.fleet === NO_FLEET_OPTION && (item.fleetCode !== null || item.hasTruck === false)) return false;
  if (f.fleet === NO_TRUCK_OPTION && item.hasTruck !== false) return false;
  if (f.fleet && ![POOL_OPTION, NO_FLEET_OPTION, NO_TRUCK_OPTION].includes(f.fleet) && item.fleetCode !== f.fleet) return false;
  if (f.dispatcher && item.current?.dispatcherId !== f.dispatcher && item.next?.dispatcherId !== f.dispatcher) return false;
  return true;
}

// The rule lives in shared since the random-draw list names dispatchers server-side (MEDSTOP-PLAN §7A.19).
export { dispatcherLabel };

type Board = Pick<DispatchBoardResponse, "fleets" | "dispatchers"> | null | undefined;

export function dispatcherOptions(board: Board): { value: string; label: string }[] {
  return [
    { value: "", label: "Anyone" },
    ...(board?.dispatchers ?? [])
      .filter((d) => !d.isSystem)
      .map((d) => ({ value: d.id, label: dispatcherLabel(d.id, board?.fleets ?? []) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];
}

export type ScopeChoice = "mine" | "all";

/**
 * My fleet or All, and which one a page opens on. A caller linked to a McLeod dispatcher opens on My
 * fleet, anyone else on All (D-DB3); the server says which once the board arrives.
 *
 * The choice lives in the URL (`?scope=`), like every other filter on both pages, so back, refresh and
 * a pasted link keep it. Absent means "not chosen", and the default follows `linked` — which is how a
 * choice is never forced back once made: making it writes the parameter. A link's own choice counts as
 * made: the board's "N uncovered loads →" opens Loads on `scope=all`, because McLeod names no dispatcher
 * on an uncovered load (0 of 32, 2026-10-09) and the queue would read empty under My fleet — a link
 * must not land on a list that contradicts it. Anything else in the parameter reads as not chosen.
 */
export function useScopeChoice(linked: Ref<boolean>, qs: Pick<UrlQueryState, "one" | "set">) {
  const choice = computed<ScopeChoice>(() => {
    const v = qs.one("scope");
    if (v === "mine" || v === "all") return v;
    return linked.value ? "mine" : "all";
  });
  function choose(v: ScopeChoice) {
    qs.set({ scope: v });
  }
  return { choice, choose };
}
