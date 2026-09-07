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
  listRow: 'min-h-13 flex-row items-center gap-3 bg-surface px-4 py-3',
  control: 'rounded-lg',
  focusRing: 'focus:border-2 focus:border-edge-focus',
} as const;
