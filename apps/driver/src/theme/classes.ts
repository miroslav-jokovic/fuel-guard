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
  // No ground of its own: a row sits in a Card or a GroupedList, which paints the surface — and
  // since D-DB16 a faint wash over it that an opaque row would have cut into bands.
  listRow: 'min-h-13 flex-row items-center gap-3 px-4 py-3',
  control: 'rounded-lg',
  focusRing: 'focus:border-2 focus:border-edge-focus',
} as const;
