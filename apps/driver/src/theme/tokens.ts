// Non-color scales (plan §11.3). Apple-inspired 8pt layout grid with a 4pt micro-spacing step.
// Components consume these decisions through the shared primitives and semantic NativeWind classes.
export const space = {
  micro: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
} as const;

// Radius is intentionally restrained: 12pt is the product card signature; full is reserved for
// pills, badges, avatars, and circular controls.
export const radius = { sm: 8, md: 12, lg: 16, full: 999 } as const;

// Touch targets exceed Apple's 44pt minimum where a driver may be wearing gloves or moving.
export const target = { minimum: 44, comfortable: 48, row: 60, cta: 56 } as const;

export const layout = {
  screenInset: 16,
  contentGap: 16,
  componentGap: 12,
  sectionGap: 24,
  cardPadding: 16,
  modalHorizontalInset: 20,
  scrollBottomInset: 96,
} as const;

export const type = {
  size: { micro: 11, xs: 12, sm: 14, base: 16, cta: 17, lg: 18, xl: 24, stat: 30, hero: 40 },
  line: { stat: 34 },
  weight: { medium: '500', semibold: '600', bold: '700' },
} as const;

export const motion = {
  fast: 160,
  standard: 220,
  emphasized: 320,
} as const;
