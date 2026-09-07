/** Design System 2.0 non-color decisions. Four points is the base quantum; names carry intent. */
export const space = {
  micro: 4,
  control: 8,
  related: 12,
  component: 16,
  comfortable: 20,
  section: 24,
  region: 32,
  screen: 40,
} as const;

/**
 * Radius communicates containment. It is not default decoration. Direction B D-DB4 fixes the scale
 * at four steps: nothing in the app may use a fifth. The Tailwind aliases carry the same numbers
 * (`rounded-md|lg|xl|2xl`), so a site that was a 12pt card is now a 24pt card without a rewrite.
 */
export const radius = {
  input: 12,
  tile: 16,
  card: 24,
  sheet: 28,
  full: 999,
} as const;

/** 44pt is the platform floor; routine and driving-critical actions deliberately exceed it. */
export const target = {
  minimum: 44,
  comfortable: 48,
  row: 52,
  cta: 56,
} as const;

export const layout = {
  screenInset: 20,
  compactGap: 8,
  relatedGap: 12,
  contentGap: 16,
  componentGap: 16,
  sectionGap: 24,
  regionGap: 32,
  groupedRowMinHeight: 52,
  /** Hero cards breathe (Direction B §2.4); cards on the light sheet stay at 16. */
  cardPadding: 20,
  sheetCardPadding: 16,
  /** How far the sheet's 28pt top corners ride over the navy hero, and its first content gap. */
  sheetOverlap: 28,
  sheetTopPadding: 24,
  modalInset: 20,
  /** Horizontal metric and choice layouts stack before accessibility sizes begin crowding copy. */
  largeTextBreakpoint: 1.35,
} as const;

/**
 * Semantic type metrics for the AppText primitive (Direction B §2.3). One typeface, Lexend, in four
 * weights; the variant picks the family because a weight utility is inert on a loaded custom face.
 *
 * `numericInline` closes the gap the 2026-09-07 critique named as P0-3: between `rowTitle` at 16 and
 * `numericCompact` at 24 there was nothing, so appointment windows, unit numbers, miles and
 * durations were rendering as 12pt muted captions — the figures a driver actually reads at a glance
 * were the smallest text on the screen.
 */
export const typography = {
  caption: { fontSize: 12, lineHeight: 16 },
  label: { fontSize: 12, lineHeight: 16, letterSpacing: 0.96 },
  supporting: { fontSize: 14, lineHeight: 20 },
  body: { fontSize: 16, lineHeight: 22 },
  rowTitle: { fontSize: 16, lineHeight: 22 },
  action: { fontSize: 17, lineHeight: 22 },
  navigationTitle: { fontSize: 18, lineHeight: 24 },
  screenTitle: { fontSize: 28, lineHeight: 32 },
  numericInline: { fontSize: 22, lineHeight: 28 },
  numericCompact: { fontSize: 24, lineHeight: 28 },
  numericHero: { fontSize: 40, lineHeight: 44 },
} as const;

export const motion = {
  instant: 0,
  press: 100,
  fast: 140,
  standard: 180,
  deliberate: 240,
  emphasized: 260,
} as const;
