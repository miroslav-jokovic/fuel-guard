const c = (name) => `rgb(var(--color-${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        canvas: c('canvas'),
        surface: {
          DEFAULT: c('surface'),
          subtle: c('surface-subtle'),
          muted: c('surface-muted'),
          raised: c('surface-raised'),
          selected: c('surface-selected'),
          inverse: c('surface-inverse'),
        },
        ink: {
          DEFAULT: c('ink'),
          secondary: c('ink-secondary'),
          muted: c('ink-muted'),
          subtle: c('ink-subtle'),
          disabled: c('ink-disabled'),
          inverse: c('ink-inverse'),
        },
        edge: {
          DEFAULT: c('edge'),
          subtle: c('edge-subtle'),
          strong: c('edge-strong'),
          focus: c('edge-focus'),
        },
        brand: {
          DEFAULT: c('brand'),
          pressed: c('brand-pressed'),
          subtle: c('brand-subtle'),
          fg: c('brand-fg'),
        },
        danger: {
          DEFAULT: c('danger'),
          soft: c('danger-soft'),
        },
        success: {
          DEFAULT: c('success'),
          soft: c('success-soft'),
        },
        warning: c('warning'),
        caution: c('caution'),
        info: c('info'),
        // Direction B D-DB1: the navy hero region and everything that sits on it.
        hero: {
          DEFAULT: c('hero'),
          raised: c('hero-raised'),
          edge: c('hero-edge'),
          tile: c('hero-tile'),
        },
        'on-hero': {
          DEFAULT: c('on-hero'),
          secondary: c('on-hero-secondary'),
          muted: c('on-hero-muted'),
        },
        // D-DB2: safety amber is the only action colour; lavender is the soft secondary.
        action: {
          DEFAULT: c('action'),
          pressed: c('action-pressed'),
          fg: c('action-fg'),
          ink: c('action-ink'),
          soft: c('action-soft'),
        },
        accent: {
          DEFAULT: c('accent'),
          ink: c('accent-ink'),
          soft: c('accent-soft'),
        },
        operation: {
          current: c('operation-current'),
          next: c('operation-next'),
          complete: c('operation-complete'),
          blocked: c('operation-blocked'),
        },
        sync: {
          local: c('sync-local'),
          pending: c('sync-pending'),
          failed: c('sync-failed'),
        },
      },
      // No fontFamily and no fontSize here, on purpose (Visual 2026 D-DV8, 2026-11-20). Type is a
      // STYLE from src/theme/typography.ts, reached through AppText's `variant` and `weight`, so there
      // is exactly one place a face or a size is decided. Until then the scale lived twice — here as
      // classes and in tokens.ts — and `text-action` meant both a font size and the amber colour.
      // 52 and 72 are real measurements in this design — the row/tab content target and the
      // separator inset that clears a 44pt disc plus its 12pt gap. They are absent from Tailwind's
      // default scale, which is the only reason `min-h-[52px]` and `ml-[72px]` existed.
      spacing: { 13: '52px', 15: '60px', 18: '72px' },
      // A chat bubble stops short of the full width so the column reads as a conversation rather
      // than as full-bleed paragraphs. Named because it is a design decision, not a stray number.
      maxWidth: { bubble: '80%' },
      borderRadius: { md: 12, lg: 16, xl: 24, '2xl': 28, full: 9999 },
    },
  },
  plugins: [],
};
