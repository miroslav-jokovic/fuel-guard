import { computed, type ComputedRef, type WritableComputedRef } from "vue";
import { useQueryState } from "@/composables/useQueryState";

/**
 * The Fuel Log's state, which is its URL (FUEL-C2 and FUEL-C3, D-FUI1/D-FUI8).
 *
 * ── THE SPLIT: THREE PARAMETERS ARE SHARED, THE REST BELONG TO THE OPEN TAB ─────────────────────
 * C2's own wording: "the window and truck filter are shared; per-tab facets render only on their own
 * tab". That is not a size limit, it is the only set where sharing is MEANINGFUL. A window and a
 * truck mean the same thing on a fill, on a decline and on a raw EFS line, so carrying them across a
 * tab switch answers the question the merge exists for — "everything this truck did in August" — in
 * one place instead of three.
 *
 * ⚠ **Nothing else may survive the crossing, and this is a correctness rule rather than a taste.**
 * `driver` is a driver ID on the fills tab and a driver NAME on the two raw-feed tabs, because the
 * EFS feed carries no driver id — one shared `?driver=` puts a UUID into a name filter and returns an
 * empty list with no error anywhere. Worse, `sort` names a COLUMN, and `fueled_at` carried from the
 * fills tab onto `declined_transactions` is not a filter that matches nothing, it is a query that
 * errors. So `tab`'s setter CLEARS every parameter that is not shared, and each tab reads its own
 * through `facet(key, allowed)` with its own vocabulary — a stale link cannot reach a database query.
 *
 * The cost is that a facet does not survive a round trip through another tab. That is the same thing
 * that happened before C2, when these were three separate pages, and it is the right direction to
 * fail: a filter that is not on the screen must not be narrowing the list.
 *
 * ── WHY THE TRUCK IS A UNIT NUMBER AND NOT A VEHICLE ID ─────────────────────────────────────────
 * Two of the three tabs read tables that have no vehicle id at all — `efs_transactions` keys on a
 * text `unit`, as printed on the EFS report. A shared key must be the one every tab can express, so
 * the unit number is the shared truck and the fills tab resolves it against the fleet it already
 * loads for its own picker. It is also what the links this page inherits already carry:
 * `/transactions?unit=654` is a real link in tickets, and C2's redirect lands it on this page with
 * that filter applied rather than dropping it.
 *
 * ── AND WHY `?unit=` NOW CARRIES A LIST WITHOUT CHANGING ITS NAME (FUEL-P1) ─────────────────────
 * "Show me 654 and 696 for August" is the ordinary shape of a conversation about a driver group, a
 * terminal or a customer's dedicated fleet, and it was not answerable anywhere in this section. The
 * filter is now a SET, held as `?unit=654,696`.
 *
 * The parameter keeps its singular name deliberately. Renaming it to `units` would be a rename with
 * no safe window and no gate watching — every `/fuel-log?unit=654` in a ticket, an email or a
 * bookmark would start returning the whole fleet, silently, which is the worst shape this kind of
 * change takes. A one-element list is exactly what a single value already meant, so the old links
 * keep working with no legacy branch to maintain, and `useQueryState.list()` is the reader for both.
 * (`useSpendFilters` spells its own truck list `?trucks=`; the two pages disagree because their
 * histories do, and a link that still works beats two pages agreeing about a word.)
 *
 * ── ONE INSTANCE, PASSED DOWN ───────────────────────────────────────────────────────────────────
 * ⚠ Call this ONCE, in the page shell, and hand the result to the tabs as a prop. `useQueryState`
 * buffers the patches applied since the last navigation settled, and each call gets its OWN buffer —
 * so two instances writing in the same tick is the lost-write bug that buffer exists to prevent,
 * reintroduced one level up. `FuelReconciliationPage` passes `useSpendFilters()` down for the same
 * reason; this follows it.
 *
 * ── WHAT THIS STILL DOES NOT DO, AND WHY THAT IS NOT AN OVERSIGHT ───────────────────────────────
 * It does not put the window through `normalizeWindow`. C3 says "adopt the `useSpendFilters`
 * pattern", and the pattern is the URL and the coalescing buffer — both adopted here. The DEFAULT is
 * not part of it: `useSpendFilters` opens on a 90-day window because a spend chart over all time is
 * meaningless, while these three lists have never had a default and "no window" means every day
 * there is. Adding one would change what an unfiltered Fuel Log shows, which is a product decision
 * rather than a refactor, and it is written up in C3's note in the plan for whoever makes it.
 */

/** The tab, in the URL. `source` rather than `transactions` — the tab is a view, not the old page. */
export const FUEL_LOG_TABS = ["fills", "declines", "source"] as const;
export type FuelLogTab = (typeof FUEL_LOG_TABS)[number];

export const DEFAULT_FUEL_LOG_TAB: FuelLogTab = "fills";

const isTab = (v: string | undefined): v is FuelLogTab =>
  !!v && (FUEL_LOG_TABS as readonly string[]).includes(v);

/**
 * The parameters that mean the same thing on every tab, and therefore the ONLY ones that survive a
 * tab change. Everything else in the query belongs to the tab that wrote it — see the header.
 */
export const SHARED_FUEL_LOG_KEYS = ["tab", "from", "to", "unit"] as const;

/**
 * ⚠ **The three shared filters are READ-ONLY refs with named setters beside them, and the tab is not.**
 *
 * This object is handed to the tab components as a prop, and `vue/no-mutating-props` refuses
 * `props.shared.unit.value = x` — correctly, because a prop whose contents a child writes is a
 * two-way channel with none of a `v-model`'s visibility. The tab is the exception: only the SHELL
 * owns it, and the shell owns this object rather than receiving it.
 *
 * `facet()` is the deliberate second exception, and it earns it: it returns one control's `v-model`,
 * over a key that tab alone owns. The alternative was a getter and a setter per facet on this
 * interface — twelve of each across the three tabs, all identical.
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
  /**
   * The trucks, as unit numbers (see the header). **EMPTY means the whole fleet, never "no trucks"** —
   * the same reading `useSpendFilters.vehicleIds` gives its own list, and the reason every consumer
   * below checks `.length` rather than truthiness.
   */
  units: ComputedRef<string[]>;
  setFrom: (v: string | undefined) => void;
  setTo: (v: string | undefined) => void;
  setUnits: (v: string[]) => void;
  /**
   * One of the OPEN TAB's own facets, as a `v-model`-able string (`""` ⇄ absent).
   *
   * `allowed` is that tab's vocabulary, and passing it is what makes a forwarded link safe: a value
   * the tab does not recognise reads as no choice at all. **Always pass it for a sort key** — see
   * the header for why a column name is the dangerous case rather than a merely useless one.
   */
  facet: (key: string, allowed?: readonly string[]) => WritableComputedRef<string>;
  /** Clear the shared filters, leaving the tab alone. Each tab clears its own facets beside this. */
  clear: () => void;
}

export function useFuelLogFilters(): FuelLogSharedFilters {
  const { q, one, list, set, param } = useQueryState();

  const tab = computed<FuelLogTab>({
    get: () => {
      const v = one("tab");
      return isTab(v) ? v : DEFAULT_FUEL_LOG_TAB;
    },
    /**
     * Changing the tab drops every parameter the outgoing tab owned, in the SAME patch that writes
     * the new tab — one navigation, so the incoming tab never renders for a tick against the
     * previous one's facets. Derived by exclusion from `SHARED_FUEL_LOG_KEYS` rather than from a
     * per-tab list of keys: a list would be a second copy of what each tab already declares at its
     * `facet()` calls, and a copy is a workaround with a delay fuse.
     */
    set: (v) => {
      const patch: Record<string, string | undefined> = { tab: v };
      for (const key of Object.keys(q.value)) {
        if (!(SHARED_FUEL_LOG_KEYS as readonly string[]).includes(key)) patch[key] = undefined;
      }
      set(patch);
    },
  });

  const write = (key: string) => (v: string | undefined) => set({ [key]: v || undefined });

  return {
    tab,
    from: computed(() => one("from")),
    to: computed(() => one("to")),
    units: computed(() => list("unit")),
    setFrom: write("from"),
    setTo: write("to"),
    // An empty selection REMOVES the parameter rather than writing `?unit=`, so "the whole fleet" has
    // one spelling in the URL instead of two that a reader would have to know are the same.
    setUnits: (v: string[]) => set({ unit: v.length ? v.join(",") : undefined }),
    facet: param,
    clear: () => set({ from: undefined, to: undefined, unit: undefined }),
  };
}
