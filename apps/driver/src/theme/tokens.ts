/** Design System 2.0 non-color decisions. Four points is the base quantum; names carry intent. */
export const space = {
  micro: 4,
  control: 8,
  related: 12,
  component: 16,
  section: 24,
  region: 32,
  screen: 40,
} as const;

/** Radius communicates containment. It is not default decoration. */
export const radius = {
  control: 10,
  container: 12,
  operational: 16,
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
  screenInset: 16,
  compactGap: 8,
  relatedGap: 12,
  contentGap: 16,
  componentGap: 16,
  sectionGap: 24,
  regionGap: 32,
  groupedRowMinHeight: 52,
  cardPadding: 16,
  scrollBottomInset: 88,
  operationalModuleMaxHeight: 200,
} as const;

/**
 * Semantic type metrics for the AppText primitive. Operational copy uses the platform UI face;
 * Hanken Grotesk is reserved for screen identity and glanceable numeric/display moments.
 */
export const typography = {
  caption: { fontSize: 12, lineHeight: 16 },
  supporting: { fontSize: 14, lineHeight: 20 },
  body: { fontSize: 16, lineHeight: 22 },
  action: { fontSize: 16, lineHeight: 20 },
  navigationTitle: { fontSize: 17, lineHeight: 22 },
  rowTitle: { fontSize: 16, lineHeight: 22 },
  sectionTitle: { fontSize: 13, lineHeight: 18 },
  screenTitle: { fontSize: 28, lineHeight: 34 },
  numericCompact: { fontSize: 24, lineHeight: 28 },
  numericHero: { fontSize: 36, lineHeight: 40 },
} as const;

export const motion = {
  instant: 0,
  press: 100,
  fast: 140,
  standard: 180,
  deliberate: 240,
  emphasized: 260,
} as const;
