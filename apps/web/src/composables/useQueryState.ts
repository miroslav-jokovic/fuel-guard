import { computed, ref, type ComputedRef } from "vue";
import { useRoute, useRouter } from "vue-router";

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
 * It does not validate. A linkable URL is one a human can hand-edit, bookmark and forward months
 * later, so every caller normalises what it reads — `useSpendFilters` puts the window through
 * `normalizeWindow`, which REPORTS what it corrected rather than correcting silently. A generic
 * buffer cannot know what "sound" means for a given parameter, and pretending otherwise is how a
 * hand-edited link reaches a database query.
 */

/** Collapse a repeated query parameter to its first value; `""` and absent both read as absent. */
export const oneParam = (v: unknown): string | undefined => {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s !== "" ? s : undefined;
};

export interface QueryState {
  /** The query as it will be once the router settles. Read this, never `route.query`. */
  q: ComputedRef<Record<string, unknown>>;
  /** One parameter, or undefined when it is absent or empty. */
  one: (key: string) => string | undefined;
  /** A comma-joined parameter as a list. Empty means "not narrowed", never "none". */
  list: (key: string) => string[];
  /** Write parameters in ONE patch; `undefined` removes one. Several keys per call, always. */
  set: (patch: Record<string, string | undefined>) => void;
}

export function useQueryState(): QueryState {
  const route = useRoute();
  const router = useRouter();

  const pending = ref<Record<string, string | undefined>>({});
  const q = computed<Record<string, unknown>>(() => ({ ...route.query, ...pending.value }));

  // `replace` throughout: adjusting a filter is not a navigation, and a reader pressing back expects
  // to leave the page rather than walk their own filter history.
  const set = (patch: Record<string, string | undefined>): void => {
    const merged = { ...pending.value, ...patch };
    pending.value = merged;
    void router
      .replace({ query: { ...route.query, ...merged } })
      // Cleared only if nothing else was written while this navigation was in flight; a later patch
      // owns the buffer and must keep it until ITS navigation lands.
      .finally(() => {
        if (pending.value === merged) pending.value = {};
      });
  };

  const one = (key: string) => oneParam(q.value[key]);
  const list = (key: string) => (one(key) ?? "").split(",").filter(Boolean);

  return { q, one, list, set };
}
