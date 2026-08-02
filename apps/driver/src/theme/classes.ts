// Canonical NativeWind recipes for the mobile design system. Keep these strings static so NativeWind
// can discover them at build time. Screens should compose these primitives instead of inventing
// one-off layout classes.
export const ui = {
  screen: 'flex-1 bg-canvas',
  scrollContent: 'p-4 gap-4',
  fixedContent: 'flex-1 gap-4 bg-canvas px-4',
  section: 'gap-3',
  sectionLabel: 'px-1 pt-2 text-micro font-sans-sb uppercase tracking-wider text-ink-muted',
  card: 'rounded-xl border border-edge-subtle bg-surface shadow-sm',
  cardContent: 'p-4 gap-1.5',
  listRow: 'min-h-[60px] flex-row items-center gap-3 rounded-xl border border-edge-subtle bg-surface px-4 py-2.5 shadow-sm',
  control: 'rounded-lg',
  focusRing: 'focus:border-2 focus:border-brand',
} as const;
