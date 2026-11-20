// Canonical NativeWind recipes for the mobile design system. Keep these strings static so NativeWind
// can discover them at build time. Screens should compose these primitives instead of inventing
// one-off layout classes.
export const ui = {
  screen: 'flex-1 bg-canvas',
  scrollContent: 'px-5 py-4 gap-4',
  /** A screen composed of `Section`s: each one owns the space above it, so the flow adds none. */
  scrollContentSections: 'px-5 py-4',
  fixedContent: 'flex-1 gap-4 bg-canvas px-5',
  section: 'gap-3',
  card: 'rounded-xl bg-surface',
  cardContent: 'p-4 gap-2',
  // No ground of its own: a row sits on the canvas in a GroupedList (Visual 2026 D-DV7). 56pt is the
  // glove target (D-DV10); px-4 is cancelled by GroupedList's -mx-4, so the text aligns with the
  // screen inset while the pressed highlight runs to the gutter.
  listRow: 'min-h-14 flex-row items-center gap-3 px-4 py-3',
  control: 'rounded-lg',
  focusRing: 'focus:border-2 focus:border-edge-focus',
} as const;
