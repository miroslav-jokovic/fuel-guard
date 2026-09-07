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
      fontFamily: {
        ui: ['Lexend_400Regular'],
        'ui-md': ['Lexend_500Medium'],
        'ui-sb': ['Lexend_600SemiBold'],
        'ui-bold': ['Lexend_700Bold'],
      },
      // Names are exactly the AppText variant names (Direction B §2.3) so a class and a variant
      // cannot drift apart. `section-title` survives only as long as the `sectionTitle` variant does.
      fontSize: {
        caption: ['12px', { lineHeight: '16px' }],
        label: ['12px', { lineHeight: '16px', letterSpacing: '0.96px' }],
        supporting: ['14px', { lineHeight: '20px' }],
        body: ['16px', { lineHeight: '22px' }],
        rowTitle: ['16px', { lineHeight: '22px' }],
        action: ['17px', { lineHeight: '22px' }],
        navigationTitle: ['18px', { lineHeight: '24px' }],
        'section-title': ['13px', { lineHeight: '18px' }],
        screenTitle: ['28px', { lineHeight: '32px' }],
        numericInline: ['22px', { lineHeight: '28px' }],
        numericCompact: ['24px', { lineHeight: '28px' }],
        numericHero: ['40px', { lineHeight: '44px' }],
      },
      borderRadius: { md: 12, lg: 16, xl: 24, '2xl': 28, full: 9999 },
    },
  },
  plugins: [],
};
