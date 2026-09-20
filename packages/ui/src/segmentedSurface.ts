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
 * The selected segment — the pill.
 *
 * ⚠ The ring and the elevation are both load-bearing now, where before the strip had neither. On a
 * grey well a white pill separated on lightness alone (1.222:1 in light); on the brand ground that
 * figure is 1.076:1, which is a hue difference and not a value one. An object that is not lighter
 * than its ground has to be raised above it, so `shadow-card` stops being decoration.
 */
export const SEGMENTED_SELECTED = "bg-surface text-ink shadow-card ring-1 ring-edge-subtle";

/** Every segment that is not the selected one. */
export const SEGMENTED_IDLE = "text-ink-muted hover:text-ink-secondary";
