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

/** Type lives in `typography.ts` (Visual 2026 D-DV8): faces, sizes and weights in one place. */
export { TYPE as typography } from './typography';

export const motion = {
  instant: 0,
  press: 100,
  fast: 140,
  standard: 180,
  deliberate: 240,
  emphasized: 260,
} as const;
