// Canonical NativeWind recipes for the mobile design system. Keep these strings static so NativeWind
// can discover them at build time. Screens should compose these primitives instead of inventing
// one-off layout classes.
export const ui = {
  screen: 'flex-1 bg-canvas',
  scrollContent: 'p-4 gap-4',
  fixedContent: 'flex-1 gap-4 bg-canvas px-4',
  section: 'gap-3',
  sectionLabel: 'pt-1 font-ui text-section-title font-semibold text-ink-secondary',
  card: 'rounded-xl border border-edge-subtle bg-surface',
  cardContent: 'p-4 gap-2',
  listRow: 'min-h-[52px] flex-row items-center gap-3 bg-surface px-4 py-2.5',
  control: 'rounded-lg',
  focusRing: 'focus:border-2 focus:border-edge-focus',
} as const;
