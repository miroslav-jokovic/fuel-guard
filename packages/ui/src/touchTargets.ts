import { computed, inject, provide, toValue, type ComputedRef, type MaybeRefOrGetter } from "vue";

/**
 * A surface pressed by a thumb: every control inside it is at least 48 CSS px (C3d3b2; 48 since
 * DESIGN-SYSTEM-CONTRACT.md §9, Maintenance M4).
 *
 * ── WHY A PROVIDED FLOOR AND NOT `size="touch"` AT EACH CALL SITE ─────────────────────────────
 * APPLICATION-FLOW-V2-PLAN.md §6.8 sets "100% ≥ 44×44 CSS px" for `/apply` (Q-AW20: `/apply` first).
 * `AppButton`, `AppCheckbox` and `AppRadioGroup` each grew a `touch` size for it (C3b2b, C3c2b), and a
 * call site had to remember to ask. The first sweep at 390 px (2026-09-28) found what that costs:
 * 20 call sites had asked, and more than a hundred controls on the same route had not — every
 * `Continue`, every text box, every checkbox list — because the fact "this whole route is touched by a
 * thumb" was being restated at each control instead of stated once. A restated fact is a workaround
 * with a delay fuse (CLAUDE.md); the next control added to `/apply` would have been 36 px again.
 *
 * So the layout says it once (`provideTouchTargets`, in `ApplyLayout.vue` and `AppShell.vue`), and each
 * primitive reads it (`useTouchTargets`) and raises ITS OWN compact sizes to the 48 px one. Nothing
 * outside a providing layout changes — the office keeps its 36 px density, which is right for a mouse.
 *
 * ── WHY 48, AND ONE FLOOR RATHER THAN TWO ──────────────────────────────────────────────────────
 * The floor was 44 (Apple's number) until the shop's phone rules (MAINTENANCE-SECTION-REDESIGN-PROPOSAL
 * §4.5, Q-MX6) set 48 (Material's) for a technician in a bay, often gloved. Two floors would be two
 * answers to one question — "how big is a thumb's target here" — so the one floor rose, and `/apply`'s
 * own bar (≥ 44, `e2e-apply/tapTargets.spec.ts`) is met with room. The date picker's calendar keeps
 * 44 px cells: seven 48 px days do not fit a 320 px phone (its own comment has the arithmetic).
 *
 * ── WHEN, NOT JUST WHETHER ────────────────────────────────────────────────────────────────────
 * `/apply` is touched by a thumb always, so it provides `true`. The shop is touched by a thumb on a
 * phone or a tablet and by a mouse at the office desk, so `AppShell` provides a getter that is true
 * only under a coarse pointer or below `md` — the office keeps its density on the very same page.
 * Hence a getter and a `ComputedRef`: the answer changes when the window or the route does.
 *
 * ── WHAT IT RAISES AND WHAT IT LEAVES ─────────────────────────────────────────────────────────
 * It raises a size, never lowers one, and never touches an inline link (`AppButton variant="link"`):
 * WCAG 2.5.8 exempts a target inside a sentence, and giving one a 48 px box would break the line.
 * The `size="touch"` props stay: they are what a control asks for OUTSIDE such a surface, and inside
 * one they now agree with the floor.
 */
const TOUCH_TARGETS = Symbol("silvicom-ui-touch-targets");

/** Called by a layout whose controls are pressed by a thumb — always, or while `when` holds. */
export function provideTouchTargets(when: MaybeRefOrGetter<boolean> = true): void {
  provide(TOUCH_TARGETS, when);
}

/** Whether this control sits inside such a layout, now. Read in setup; unwrapped in templates. */
export function useTouchTargets(): ComputedRef<boolean> {
  const when = inject<MaybeRefOrGetter<boolean>>(TOUCH_TARGETS, false);
  return computed(() => toValue(when));
}
