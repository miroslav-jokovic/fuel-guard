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
          inverse: c('surface-inverse'),
        },
        ink: {
          DEFAULT: c('ink'),
          secondary: c('ink-secondary'),
          muted: c('ink-muted'),
          subtle: c('ink-subtle'),
          inverse: c('ink-inverse'),
        },
        edge: { DEFAULT: c('edge'), subtle: c('edge-subtle'), strong: c('edge-strong') },
        brand: { DEFAULT: c('brand'), fg: c('brand-fg') },
        danger: c('danger'),
        warning: c('warning'),
        caution: c('caution'),
        success: c('success'),
        info: c('info'),
      },
      fontFamily: {
        sans:       ['HankenGrotesk_400Regular', 'system-ui', 'sans-serif'],
        'sans-md':  ['HankenGrotesk_500Medium',  'system-ui', 'sans-serif'],
        'sans-sb':  ['HankenGrotesk_600SemiBold','system-ui', 'sans-serif'],
        'sans-bold':['HankenGrotesk_700Bold',    'system-ui', 'sans-serif'],
      },
      fontSize: {
        micro: ['11px', { lineHeight: '16px' }],
        cta: ['17px', { lineHeight: '24px' }],
      },
      borderRadius: { md: 6, lg: 8, xl: 12 },
    },
  },
  plugins: [],
};
