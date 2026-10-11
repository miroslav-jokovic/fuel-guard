import { inject, provide } from "vue";

/**
 * A surface pressed by a thumb: every control inside it is at least 44 CSS px (C3d3b2).
 *
 * ── WHY A PROVIDED FLOOR AND NOT `size="touch"` AT EACH CALL SITE ─────────────────────────────
 * APPLICATION-FLOW-V2-PLAN.md §6.8 sets "100% ≥ 44×44 CSS px" for `/apply` (Q-AW20: `/apply` only).
 * `AppButton`, `AppCheckbox` and `AppRadioGroup` each grew a `touch` size for it (C3b2b, C3c2b), and a
 * call site had to remember to ask. The first sweep at 390 px (2026-09-28) found what that costs:
 * 20 call sites had asked, and more than a hundred controls on the same route had not — every
 * `Continue`, every text box, every checkbox list — because the fact "this whole route is touched by a
 * thumb" was being restated at each control instead of stated once. A restated fact is a workaround
 * with a delay fuse (CLAUDE.md); the next control added to `/apply` would have been 36 px again.
 *
 * So the layout says it once (`provideTouchTargets`, in `ApplyLayout.vue`), and each primitive reads it
 * (`useTouchTargets`) and raises ITS OWN compact sizes to the 44 px one. Nothing outside a providing
 * layout changes — the office keeps its 36 px density, which is right for a mouse.
 *
 * ── WHAT IT RAISES AND WHAT IT LEAVES ─────────────────────────────────────────────────────────
 * It raises a size, never lowers one, and never touches an inline link (`AppButton variant="link"`):
 * WCAG 2.5.8 exempts a target inside a sentence, and giving one a 44 px box would break the line.
 * The `size="touch"` props stay: they are what a control asks for OUTSIDE such a surface, and inside
 * one they now agree with the floor.
 */
const TOUCH_TARGETS = Symbol("silvicom-ui-touch-targets");

/** Called by a layout whose every control is pressed by a thumb. */
export function provideTouchTargets(): void {
  provide(TOUCH_TARGETS, true);
}

/** Whether this control sits inside such a layout. Read once, in setup. */
export function useTouchTargets(): boolean {
  return inject(TOUCH_TARGETS, false);
}
