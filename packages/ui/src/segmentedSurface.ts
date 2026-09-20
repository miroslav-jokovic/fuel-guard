/**
 * The well-and-pill recipe, owned once (D-DT16).
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
 * `AppTabs` and `AppSegmentedControl` are two widgets, deliberately — a `role="tablist"` that
 * switches a panel and a `role="radiogroup"` that answers a question are different promises to a
 * screen reader, and each component's own header argues that well. What they are NOT is two
 * designs. Both drew `rounded-surface bg-surface-muted p-*` with a `bg-surface` pill in it, and
 * because each wrote its own copy the two had already drifted: the segmented control's pill carried
 * `shadow-card` and the tab strip's did not, so the same object was raised in one place and flat in
 * the other. Nobody decided that.
 *
 * The cost of the copy is not the duplication, it is that the strip cannot be RESTYLED — which is
 * exactly what D-DT16 asks for, and why de-greying it had to wait for one map to change.
 *
 * ── WHAT IS SHARED AND WHAT IS NOT ─────────────────────────────────────────────────────────────
 * Shared: the LOOK — ground, ring, radius, the pill's surface and elevation, the idle ink and its
 * hover. Not shared: geometry. The tab strip is a flex row at `p-1`; the segmented control is an
 * `auto-cols-fr` grid at `p-0.5` because it lives in a permissions table cell, eleven rows to a
 * role, where four extra pixels per control is a page taller. Two densities is a real difference
 * (the prototype's own `--sm` variant is the same admission); one ground colour in two files is not.
 *
 * ── THE DE-GREY, MEASURED ──────────────────────────────────────────────────────────────────────
 * A grey well spends a solid block of ink saying "these three things belong together", which
 * proximity already said for free, and spends the page's only large neutral field on a control
 * rather than on data. The ground is now `--control-well` — brand-tinted, 1.004:1 against
 * `--canvas` in light — so the well reads from its ring and the pill reads from its elevation,
 * the way a raised object separates rather than the way a hole does. The idle label gets MORE
 * contrast, not less: `--ink-muted` measures 5.48:1 on the new ground against 4.82:1 on
 * `--surface-muted` in light, 5.67:1 against 5.33:1 in dark (2026-09-20, both schemes computed
 * from the token values in `packages/tokens/src`).
 */

/**
 * The well itself. Padding and gap are the caller's — see the header — and so is `display`.
 *
 * ⚠ `ring-inset`: the ring is the well's own boundary, so it must not eat the page gutter beside a
 * strip that is already flush with a card edge.
 */
export const SEGMENTED_WELL = "rounded-surface bg-control-well ring-1 ring-inset ring-control-well-edge";

/**
 * One segment's invariant face. No padding-Y and no height: the tab strip sizes on its label and
 * the segmented control pins `min-h-8` to match the field scale beside it.
 */
export const SEGMENTED_SEGMENT =
  "rounded-control px-3 font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/**
 * The pill — the raised object the selection sits on.
 *
 * ⚠ The ring and the elevation are both load-bearing, where before the strip had neither. On a grey
 * well a white pill separated on lightness alone (1.222:1 in light); on the brand ground that
 * figure is 1.076:1, which is a hue difference and not a value one. An object that is not lighter
 * than its ground has to be raised above it, so `shadow-card` stops being decoration.
 *
 * ⚠ It is the same LOOK in both widgets and no longer the same MECHANISM, which is the one place
 * this module's "shared" claim needs reading carefully. In `AppSegmentedControl` these classes sit
 * on the chosen button. In `AppTabs` they sit on a single absolutely-positioned element that
 * travels, because a selection that teleports between four backgrounds cannot be interrupted and
 * carries no sense of having MOVED (D-DT9/D-DT10). One constant, so the two cannot drift; two
 * mechanisms, because only one of them is worth a spring — eleven segmented controls per
 * permissions row, each springing, is motion nobody asked for.
 */
export const SEGMENTED_PILL = "bg-surface shadow-card ring-1 ring-edge-subtle";

/** Every segment that is not the selected one. */
export const SEGMENTED_IDLE = "text-ink-muted hover:text-ink-secondary";

/**
 * The selected segment's INK, and it is a different answer per widget (D-DT16).
 *
 * A tab strip is navigation, where brand means "you are here", so the selected tab takes brand ink
 * for its label and its count. A segmented control ANSWERS something — None / View / Manage — and
 * the answer is a value, not a place; three brand-tinted controls in one form row would each claim
 * to be the thing you are looking at. Its chosen segment stays `--ink`. (This is the same
 * distinction the plan draws for its `--sm` period switcher, arriving early because the two
 * widgets already exist.)
 *
 * ⚠ `--selected-strong`, not `--action-primary`, and the substitution is measured rather than
 * stylistic. D-DT16 names `--action-primary`; on the pill's `--surface` that is 5.29:1 in light but
 * **4.37:1 in dark**, and a 14px tab label is normal-size text, which WCAG 1.4.3 puts at 4.5:1.
 * `--selected-strong` is the role the system already has for "selected, emphatic", is the identical
 * value in light, and measures 5.62:1 in dark. `lint:ui-contrast` pins both.
 */
export const SEGMENTED_SELECTED_INK = "text-ink";
export const SEGMENTED_NAVIGATION_INK = "text-selected-strong";

/**
 * A tab's trailing count.
 *
 * ⚠ Not `--surface-muted`: a grey pill inside a strip that just stopped being grey is the one
 * neutral left on the control, and the eye goes to it rather than to the tab. The ground is a
 * translucent brand tint so it reads the same over the well and over the pill; the count follows
 * its label into brand when its tab is selected, so one selection is stated once in every part of
 * the tab rather than in the label alone.
 *
 * ⚠ The SELECTED ground needs different ramp steps per scheme, for the reason the chip does. Over
 * the pill, `--ramp-brand-100` measures 4.66:1 against the count's ink in light and 4.10:1 in dark
 * — under the 4.5:1 an 11px figure needs. `--control-count-selected` is brand-100 in light and
 * brand-50 in dark, which measures 4.66:1 and 4.92:1.
 */
export const SEGMENTED_COUNT = "rounded-full px-1.5 text-2xs font-semibold transition";
export const SEGMENTED_COUNT_IDLE = "bg-control-count text-ink-tertiary";
export const SEGMENTED_COUNT_SELECTED = "bg-control-count-selected text-selected-strong";
