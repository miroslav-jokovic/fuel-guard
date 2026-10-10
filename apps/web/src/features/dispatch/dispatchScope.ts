import { ref, watch, type Ref } from "vue";
import { inMyScope, type DispatchBoardResponse, type DispatchScope } from "@silvicom/shared";
import type { FilterChip } from "@/components/ui/FilterBar.vue";

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

export interface ScopeFilter {
  mine: boolean;
  fleet: string;
  dispatcher: string;
}

/** What scope is judged on: the truck's fleet, and the dispatcher of each load in question. */
export interface ScopedItem {
  fleetCode: string | null;
  current: { dispatcherId: string | null } | null;
  next: { dispatcherId: string | null } | null;
}

/** Does the My fleet / Fleet / Dispatched-by choice admit this item? */
export function admitsScope(item: ScopedItem, scope: DispatchScope, f: ScopeFilter): boolean {
  if (f.mine && !inMyScope(item, scope)) return false;
  if (f.fleet === POOL_OPTION && item.fleetCode !== POOL_FLEET) return false;
  if (f.fleet === NO_FLEET_OPTION && item.fleetCode !== null) return false;
  if (f.fleet && f.fleet !== POOL_OPTION && f.fleet !== NO_FLEET_OPTION && item.fleetCode !== f.fleet) return false;
  if (f.dispatcher && item.current?.dispatcherId !== f.dispatcher && item.next?.dispatcherId !== f.dispatcher) return false;
  return true;
}

/** A dispatcher's display name from the McLeod roster, falling back to the login. */
export function dispatcherName(id: string | null | undefined, dispatchers: ReadonlyArray<{ id: string; name: string | null }>): string {
  if (!id) return "";
  return dispatchers.find((d) => d.id === id)?.name || id;
}

type Board = Pick<DispatchBoardResponse, "fleets" | "dispatchers"> | null | undefined;

export function fleetOptions(board: Board): { value: string; label: string }[] {
  const dispatchers = board?.dispatchers ?? [];
  return [
    { value: "", label: "All fleets" },
    ...(board?.fleets ?? [])
      .filter((f) => f.code !== POOL_FLEET)
      .map((f) => ({ value: f.code, label: f.dispatcherId ? `${f.code} · ${dispatcherName(f.dispatcherId, dispatchers)}` : f.code })),
    { value: POOL_OPTION, label: "Unassigned pool" },
    { value: NO_FLEET_OPTION, label: "No fleet" },
  ];
}

export function dispatcherOptions(board: Board): { value: string; label: string }[] {
  return [
    { value: "", label: "Anyone" },
    ...(board?.dispatchers ?? []).filter((d) => !d.isSystem).map((d) => ({ value: d.id, label: d.name || d.id })),
  ];
}

/** The chips a scope choice adds to a FilterBar, keyed `fleet` and `dispatcher` for the page's remove handler. */
export function scopeChips(f: ScopeFilter, board: Board): FilterChip[] {
  const out: FilterChip[] = [];
  if (f.fleet) out.push({ key: "fleet", label: "Fleet", value: fleetOptions(board).find((o) => o.value === f.fleet)?.label ?? f.fleet });
  if (f.dispatcher) out.push({ key: "dispatcher", label: "Dispatched by", value: dispatcherName(f.dispatcher, board?.dispatchers ?? []) });
  return out;
}

export type ScopeChoice = "mine" | "all";

/**
 * My fleet or All, and which one a page opens on. A caller linked to a McLeod dispatcher opens on My
 * fleet, anyone else on All (D-DB3); the server says which once the board arrives, so the choice
 * follows `linked` until the person makes one, and is never forced back after that.
 *
 * `fromUrl` is a link's own choice and counts as made: the board's "N uncovered loads →" opens Loads
 * on `scope=all`, because McLeod names no dispatcher on an uncovered load (0 of 32, 2026-10-09) and
 * the queue would read empty under My fleet — a link must not land on a list that contradicts it.
 */
export function useScopeChoice(linked: Ref<boolean>, fromUrl: unknown = null) {
  const preset: ScopeChoice | null = fromUrl === "mine" || fromUrl === "all" ? fromUrl : null;
  const choice = ref<ScopeChoice>(preset ?? "all");
  let chosen = preset !== null;
  watch(
    linked,
    (l) => {
      if (!chosen) choice.value = l ? "mine" : "all";
    },
    { immediate: true },
  );
  function choose(v: ScopeChoice) {
    chosen = true;
    choice.value = v;
  }
  return { choice, choose };
}
