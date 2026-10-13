import { computed, ref, type ComputedRef, type Ref, type WritableComputedRef } from "vue";
import { useRoute, useRouter, type Router } from "vue-router";

/**
 * The URL as the page's state, for any table or view that has to be linkable.
 *
 * ── WHY THIS IS A COMPOSABLE AND NOT A PATTERN TO COPY ───────────────────────────────────────────
 * `router.replace` is ASYNCHRONOUS: `route.query` does not change until the navigation resolves. So
 * two filters written in the same tick both read the same pre-change query, and the second `replace`
 * silently overwrites the first. This is not a hypothetical — it shipped to production on the
 * fuel-spend page and read as a broken control rather than a bug: `DateRangeFilter` emits
 * `update:from` and `update:to` back to back, `to` landed, `from` was dropped, and the getter fell
 * back to its default. The visible symptom was a date picker welded to the last 90 days, where every
 * pick appeared to do nothing. Both halves worked in isolation, which is why every unit test that set
 * one filter at a time passed.
 *
 * `pending` holds the patches applied since the last navigation settled, and `q` reads through it, so
 * a getter never lags a tick behind its own setter and no write can be lost to another write in the
 * same tick.
 *
 * ── WHY IT LIVES HERE RATHER THAN IN THE FEATURE THAT FIRST NEEDED IT ────────────────────────────
 * It was written inside `features/reconcile/useSpendFilters.ts`. D-ROS14 makes the URL the definition
 * of a saved view, so the roster needs the same buffer — and a `roster` surface may not import a
 * `reconcile` internal (`lint:boundaries`). `check-feature-boundaries.mjs` says in its own comment
 * what to do about that, and it is the reason this file exists: promote the shared thing out of
 * `features/`, do not allow-list the leak. Promoted at R3a, 2026-08-30.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────────────────────────────────
 * It does not validate — and `param(key, allowed)` below is not an exception to that, it is the
 * shape of it. A linkable URL is one a human can hand-edit, bookmark and forward months later, so
 * every caller normalises what it reads: `useSpendFilters` puts the window through `normalizeWindow`,
 * which REPORTS what it corrected rather than correcting silently. A generic buffer cannot know what
 * "sound" means for a given parameter, and pretending otherwise is how a hand-edited link reaches a
 * database query. `param`'s `allowed` list is the CALLER's vocabulary, passed in at the call site;
 * this file still holds no opinion about any parameter's meaning.
 */

/** Collapse a repeated query parameter to its first value; `""` and absent both read as absent. */
export const oneParam = (v: unknown): string | undefined => {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s !== "" ? s : undefined;
};

/**
 * The value a defaulted parameter is written as when the reader chooses "no narrowing at all".
 *
 * A list that opens narrowed — Vehicles on "Active", Recruitment on "Waiting on us" — keeps its default
 * OUT of the URL, so a plain link opens the list the way everybody expects. That leaves absence
 * meaning "the default", and the reader's "All statuses" needs a spelling of its own, or picking it
 * would write nothing and the list would snap back to Active. `any` is that spelling; it is never a
 * value in any caller's vocabulary.
 */
export const ANY_PARAM = "any";

export interface QueryState {
  /** The query as it will be once the router settles. Read this, never `route.query`. */
  q: ComputedRef<Record<string, unknown>>;
  /** One parameter, or undefined when it is absent or empty. */
  one: (key: string) => string | undefined;
  /** A comma-joined parameter as a list. Empty means "not narrowed", never "none". */
  list: (key: string) => string[];
  /** Write parameters in ONE patch; `undefined` removes one. Several keys per call, always. */
  set: (patch: Record<string, string | undefined>) => void;
  /**
   * One parameter as a `v-model`-able string, `""` ⇄ absent, for a filter control.
   *
   * `FilterSelect` and `FilterBar` speak `""` for "no choice" and the URL speaks absence, and every
   * filtered page in this app had written that conversion out by hand — nine times on the fuel cards
   * page alone. This is that conversion, once.
   *
   * `allowed` is the caller's own vocabulary and is what a hand-edited link is checked against: a
   * value outside it reads as no choice at all. Pass it wherever the parameter has a closed set —
   * ⚠ **especially a sort key**, because a column name from one table pasted into another table's
   * URL is not a filter that matches nothing, it is a query that errors.
   *
   * `fallback` is the value the list opens on. It reads when the parameter is absent and is never
   * written (choosing it removes the parameter); choosing `""` then writes `ANY_PARAM`, see above. A
   * value outside `allowed` reads as the fallback, not as `""` — a stale link opens the list the way
   * a plain link would.
   */
  param: (key: string, allowed?: readonly string[], fallback?: string) => WritableComputedRef<string>;
  /** An on/off filter ("Show retired"): `1` when on, absent when off. */
  flag: (key: string) => WritableComputedRef<boolean>;
  /**
   * The table's page, absent on page 1. In the URL so that Back from a row's detail page returns to
   * page 3 rather than page 1 — the one place a list's position is worth a parameter.
   */
  page: (key?: string) => WritableComputedRef<number>;
}

/**
 * One buffer per router, not per caller.
 *
 * A page and a tab inside it each call `useQueryState`, and before 2026-10-12 each got its own
 * buffer — which reopened the very race this file exists to close: the page's write and the tab's
 * write in one tick each spread the same stale `route.query`, and the second dropped the first. Keys
 * were always shared (they are one URL); the buffer has to be too.
 */
const buffers = new WeakMap<Router, Ref<Record<string, string | undefined>>>();

/**
 * `scope` prefixes every key this caller reads and writes (`history.from`), for a list that shares
 * its route with another list — Assignment history beside the board, the qualification file inside
 * the driver page. Without it, two lists on one page would both own `?search=`.
 */
export function useQueryState(scope?: string): QueryState {
  const route = useRoute();
  const router = useRouter();
  const k = (key: string) => (scope ? `${scope}.${key}` : key);

  let pending = buffers.get(router);
  if (!pending) {
    pending = ref<Record<string, string | undefined>>({});
    buffers.set(router, pending);
  }
  const buffer = pending;
  const q = computed<Record<string, unknown>>(() => ({ ...route.query, ...buffer.value }));

  // `replace` throughout: adjusting a filter is not a navigation, and a reader pressing back expects
  // to leave the page rather than walk their own filter history.
  const write = (patch: Record<string, string | undefined>): void => {
    const merged = { ...buffer.value, ...patch };
    buffer.value = merged;
    void router
      .replace({ query: { ...route.query, ...merged } })
      // Cleared only if nothing else was written while this navigation was in flight; a later patch
      // owns the buffer and must keep it until ITS navigation lands.
      .finally(() => {
        if (buffer.value === merged) buffer.value = {};
      });
  };
  const set = (patch: Record<string, string | undefined>): void =>
    write(Object.fromEntries(Object.entries(patch).map(([key, v]) => [k(key), v])));

  const one = (key: string) => oneParam(q.value[k(key)]);
  const list = (key: string) => (one(key) ?? "").split(",").filter(Boolean);

  const param = (key: string, allowed?: readonly string[], fallback = ""): WritableComputedRef<string> =>
    computed({
      get: () => {
        const v = one(key);
        if (v === undefined) return fallback;
        if (fallback && v === ANY_PARAM) return "";
        return allowed && !allowed.includes(v) ? fallback : v;
      },
      set: (v: string) => set({ [key]: v === fallback ? undefined : v || ANY_PARAM }),
    });

  const flag = (key: string): WritableComputedRef<boolean> =>
    computed({
      get: () => one(key) === "1",
      set: (on: boolean) => set({ [key]: on ? "1" : undefined }),
    });

  const page = (key = "page"): WritableComputedRef<number> =>
    computed({
      get: () => {
        const n = Number(one(key));
        return Number.isInteger(n) && n > 1 ? n : 1;
      },
      set: (n: number) => set({ [key]: n > 1 ? String(n) : undefined }),
    });

  return { q, one, list, set, param, flag, page };
}
