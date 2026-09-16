import { computed, ref, type ComputedRef } from "vue";

/**
 * A per-device set of the things somebody has CHANGED from their default — nav sections they have
 * collapsed, floating map panels they have shut or opened.
 *
 * ── IT STORES THE DEVIATION, NEVER THE STATE ─────────────────────────────────────────────────────
 * `useSidebarSections` learned this the hard way in phase 6 and wrote it down; this file is that
 * lesson generalised rather than transcribed a third time. Nothing is stored until somebody
 * expresses a preference, so the set starts EMPTY — while the sidebar starts fully expanded. Store
 * the OPEN sections and the empty set means "everything collapsed", the opposite of what is on
 * screen, so the displayed state and the stored state disagree at exactly the moment the two first
 * have to meet: the first click adds the section to the "open" set and leaves it open.
 *
 * The sidebar fixed that by storing the closed ones, which works because every section defaults to
 * open. The live map's panels do not all share one default — the fleet dock starts shut and the two
 * corner panels start open (`liveMapPanels.ts` argues that asymmetry) — so "store the closed ones"
 * would reintroduce the same contradiction for the dock alone. Storing the DEVIATION is the form of
 * the rule that survives both: empty means everything is at its default, whatever each default is,
 * and every toggle after it is symmetric.
 *
 * ── WHY `localStorage` AND NOT `user_dashboard_layout` ───────────────────────────────────────────
 * D-DR6 first said the live map's panels reuse LM10's per-user layout row. They cannot, and the
 * design-refresh plan's §7 carries the measurement: `PUT /api/dashboard-layout` REFUSES any key
 * outside `DASHBOARD_WIDGETS`, and `check-surfaces.mjs` asserts in both directions that every
 * catalogue entry names a real `DASHBOARD_TABS` tab and a real component. Getting a `livemap.*` key
 * past both would mean inventing a widget, a tab and a component that nothing renders — three
 * fictions to store one boolean — and the permissions preview page would then list them as things a
 * role can be granted. This is chrome state, of the same class as "is the sidebar collapsed", and it
 * goes where the sidebar's already does.
 *
 * ⚠ A third caller of this argument exists and is NOT on this composable: `useTableColumns` stores
 * hidden columns with the same reasoning, plus an ordering and a legal obligation about which
 * columns a reader may hide. Folding it in is its own step, named in
 * `docs/plans/design-system/DESIGN-REFRESH-2026-09.md` §7 rather than left to be rediscovered.
 */
export interface DeviationSet {
  /** True when `key` has been moved off its default. An unknown key is at its default. */
  has: (key: string) => boolean;
  toggle: (key: string) => void;
  /** Exposed for tests and for any future "put everything back" affordance. */
  count: ComputedRef<number>;
}

function read(storageKey: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
  } catch {
    // No storage — Safari private mode throws, and this project's own jsdom has none at all.
    return new Set();
  }
}

/**
 * Build one, at MODULE scope in the caller.
 *
 * There is one sidebar and one live map per browser tab, and the state has to survive a component
 * being unmounted and remounted by a route change — a `ref` created inside `setup` would reset every
 * time the dispatcher navigated away and back, which reads as "it forgot", not as "it reloaded".
 */
export function createDeviationSet(storageKey: string): DeviationSet {
  const changed = ref<Set<string>>(read(storageKey));

  return {
    has: (key) => changed.value.has(key),
    toggle(key) {
      const next = new Set(changed.value);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      changed.value = next;
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        // A preference that cannot be stored still applies for this session.
      }
    },
    count: computed(() => changed.value.size),
  };
}
