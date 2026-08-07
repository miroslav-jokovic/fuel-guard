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
        danger: c('danger'),
        warning: c('warning'),
        caution: c('caution'),
        success: c('success'),
        info: c('info'),
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
        ui:         ['system-ui', 'sans-serif'],
        display:    ['HankenGrotesk_400Regular', 'system-ui', 'sans-serif'],
        'display-md':  ['HankenGrotesk_500Medium',  'system-ui', 'sans-serif'],
        'display-sb':  ['HankenGrotesk_600SemiBold','system-ui', 'sans-serif'],
        'display-bold':['HankenGrotesk_700Bold',    'system-ui', 'sans-serif'],
      },
      fontSize: {
        micro: ['11px', { lineHeight: '16px' }],
        cta: ['17px', { lineHeight: '24px' }],
        caption: ['12px', { lineHeight: '16px' }],
        supporting: ['14px', { lineHeight: '20px' }],
        body: ['16px', { lineHeight: '22px' }],
        action: ['16px', { lineHeight: '20px' }],
        nav: ['17px', { lineHeight: '22px' }],
        'section-title': ['13px', { lineHeight: '18px' }],
        'screen-title': ['28px', { lineHeight: '34px' }],
        'numeric-compact': ['24px', { lineHeight: '28px' }],
        'numeric-hero': ['36px', { lineHeight: '40px' }],
      },
      borderRadius: { md: 8, lg: 10, xl: 12, '2xl': 16 },
    },
  },
  plugins: [],
};
