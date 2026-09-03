import { computed, type ComputedRef, type WritableComputedRef } from "vue";
import { useQueryState } from "@/composables/useQueryState";

/**
 * The filters the three Fuel Log tabs SHARE, held in the URL (FUEL-C2, D-FUI1).
 *
 * ── WHY ONLY TWO FILTERS AND A TAB ARE IN HERE ──────────────────────────────────────────────────
 * C2's own wording: "the window and truck filter are shared; per-tab facets render only on their own
 * tab". That is not a size limit, it is the only set where sharing is meaningful. A window and a
 * truck mean the same thing on a fill, on a decline and on a raw EFS line, so carrying them across a
 * tab switch answers the question the merge exists for — "everything this truck did in August" — in
 * one place instead of three.
 *
 * Nothing else survives the crossing. `driver` is a driver ID on the fills tab and a driver NAME on
 * the two raw-feed tabs, because the EFS feed carries no driver id; sharing one `?driver=` would put
 * a UUID into a name filter on the next tab and return an empty list with no error anywhere. `state`
 * exists on the raw tabs and not on fills. `search` matches different columns on each. So the facets
 * stay local to their tab, and this file holds the three parameters that mean one thing.
 *
 * ── WHY THE TRUCK IS A UNIT NUMBER AND NOT A VEHICLE ID ─────────────────────────────────────────
 * Two of the three tabs read tables that have no vehicle id at all — `efs_transactions` keys on a
 * text `unit`, as printed on the EFS report. A shared key must be the one every tab can express, so
 * the unit number is the shared truck and the fills tab resolves it against the fleet it already
 * loads for its own picker. It is also what the links this page inherits already carry:
 * `/transactions?unit=654` is a real link in tickets, and C2's redirect lands it on this page with
 * that filter applied rather than dropping it.
 *
 * ── ONE INSTANCE, PASSED DOWN ───────────────────────────────────────────────────────────────────
 * ⚠ Call this ONCE, in the page shell, and hand the result to the tabs as a prop. `useQueryState`
 * buffers the patches applied since the last navigation settled, and each call gets its OWN buffer —
 * so two instances writing in the same tick is the lost-write bug that buffer exists to prevent,
 * reintroduced one level up. `FuelReconciliationPage` passes `useSpendFilters()` down for the same
 * reason; this follows it.
 *
 * This does NOT validate the window. A linkable URL is one a human can hand-edit, and the fuel list
 * pages have never had a default window (absent = every day there is), so `normalizeWindow`'s
 * default-and-report behaviour would change what an unfiltered page shows. C3 is the step that
 * adopts the `useSpendFilters` contract across the section; until then this is transcription.
 */

/** The tab, in the URL. `source` rather than `transactions` — the tab is a view, not the old page. */
export const FUEL_LOG_TABS = ["fills", "declines", "source"] as const;
export type FuelLogTab = (typeof FUEL_LOG_TABS)[number];

export const DEFAULT_FUEL_LOG_TAB: FuelLogTab = "fills";

const isTab = (v: string | undefined): v is FuelLogTab =>
  !!v && (FUEL_LOG_TABS as readonly string[]).includes(v);

/**
 * ⚠ **The three filters are READ-ONLY refs with named setters beside them, and the tab is not.**
 *
 * This object is handed to the tab components as a prop, and `vue/no-mutating-props` refuses
 * `props.shared.unit.value = x` — correctly, because a prop whose contents a child writes is a
 * two-way channel with none of a `v-model`'s visibility. The tab is the exception: only the SHELL
 * owns it, and the shell owns this object rather than receiving it.
 *
 * `setFrom` and `setTo` are two calls rather than one `setWindow`, because `DateRangeFilter` emits
 * `update:from` and `update:to` back to back and `useQueryState` buffers patches until the router
 * settles — the lost-write that welded the spend page's date picker to 90 days is handled there,
 * once, for every caller. (`useSpendFilters` writes both ends together for a different reason: it
 * NORMALISES the window, and half a normalised range is not a range.)
 */
export interface FuelLogSharedFilters {
  /**
   * Which tab the URL names. Unknown values read as `fills` — a stale or hand-edited link must land
   * on a page rather than on nothing. The SHELL narrows this further to the tabs the caller may see.
   */
  tab: WritableComputedRef<FuelLogTab>;
  /** Window start, `YYYY-MM-DD`, inclusive. `undefined` means unbounded, not "today". */
  from: ComputedRef<string | undefined>;
  /** Window end, `YYYY-MM-DD`, inclusive. */
  to: ComputedRef<string | undefined>;
  /** The truck, as a unit number (see the header). `undefined` means the whole fleet. */
  unit: ComputedRef<string | undefined>;
  setFrom: (v: string | undefined) => void;
  setTo: (v: string | undefined) => void;
  setUnit: (v: string | undefined) => void;
  /** Clear the shared filters, leaving the tab alone. Each tab clears its own facets beside this. */
  clear: () => void;
}

export function useFuelLogFilters(): FuelLogSharedFilters {
  const { one, set } = useQueryState();

  const tab = computed<FuelLogTab>({
    get: () => {
      const v = one("tab");
      return isTab(v) ? v : DEFAULT_FUEL_LOG_TAB;
    },
    set: (v) => set({ tab: v }),
  });

  const write = (key: string) => (v: string | undefined) => set({ [key]: v || undefined });

  return {
    tab,
    from: computed(() => one("from")),
    to: computed(() => one("to")),
    unit: computed(() => one("unit")),
    setFrom: write("from"),
    setTo: write("to"),
    setUnit: write("unit"),
    clear: () => set({ from: undefined, to: undefined, unit: undefined }),
  };
}
