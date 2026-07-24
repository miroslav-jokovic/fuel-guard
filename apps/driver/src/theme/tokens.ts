// Non-color scales (plan §11.3). Radius/space mirror the web; primary touch targets >= 48pt.
export const radius = { md: 6, lg: 8, xl: 12 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const target = { min: 48, cta: 56 } as const; // glove-friendly (plan §22)
export const type = {
  size: { xs: 12, sm: 14, base: 16, lg: 18, xl: 24, hero: 40 },
  weight: { medium: '500', semibold: '600', bold: '700' },
} as const;
