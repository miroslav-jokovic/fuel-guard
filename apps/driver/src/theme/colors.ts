import { ramps } from './ramps';

// Raw color values for the few RN/native APIs that take a color string (not className):
// tab-bar tint, ActivityIndicator, status bar, and SVG strokes/fills (react-native-svg has no
// className). These live in src/theme (the only place the token linter allows raw color) so
// screens/components stay className-only. Values mirror the global.css role map exactly.
export const roleColors = {
  light: {
    brand: ramps.brand[600],
    ink: ramps.neutral[900],
    inkSecondary: ramps.neutral[700],
    inkMuted: ramps.neutral[500],
    inkSubtle: ramps.neutral[400],
    inkInverse: '#ffffff',
    surface: '#ffffff',
    surfaceMuted: ramps.neutral[100],
    edge: ramps.neutral[200],
    danger: ramps.danger[600],
    warning: ramps.warning[600],
    caution: ramps.caution[600],
    success: ramps.success[600],
    info: ramps.info[600],
  },
  dark: {
    brand: ramps.brand[500],
    ink: ramps.neutral[50],
    inkSecondary: ramps.neutral[200],
    inkMuted: ramps.neutral[400],
    inkSubtle: ramps.neutral[500],
    inkInverse: ramps.neutral[900],
    surface: ramps.neutral[800],
    surfaceMuted: ramps.neutral[700],
    edge: ramps.neutral[700],
    danger: ramps.danger[400],
    warning: ramps.warning[400],
    caution: ramps.caution[400],
    success: ramps.success[400],
    info: ramps.info[400],
  },
} as const;

// NativeWind's .dark selector is not a DOM ancestor on native. Apply the semantic variable map
// directly to a provider View so the same className tokens switch immediately on iOS and Android.
export const themeVars = {
  light: {
    '--color-canvas': '249 250 251',
    '--color-surface': '255 255 255',
    '--color-surface-subtle': '249 250 251',
    '--color-surface-muted': '243 244 246',
    '--color-surface-inverse': '17 24 39',
    '--color-ink': '17 24 39',
    '--color-ink-secondary': '55 65 81',
    '--color-ink-muted': '107 114 128',
    '--color-ink-subtle': '156 163 175',
    '--color-ink-inverse': '255 255 255',
    '--color-edge-subtle': '243 244 246',
    '--color-edge': '229 231 235',
    '--color-edge-strong': '209 213 219',
    '--color-brand': '79 70 229',
    '--color-brand-fg': '255 255 255',
    '--color-danger': '220 38 38',
    '--color-warning': '217 119 6',
    '--color-caution': '234 88 12',
    '--color-success': '22 163 74',
    '--color-info': '37 99 235',
  },
  dark: {
    '--color-canvas': '10 12 14',
    '--color-surface': '31 41 55',
    '--color-surface-subtle': '24 31 42',
    '--color-surface-muted': '55 65 81',
    '--color-surface-inverse': '229 231 235',
    '--color-ink': '249 250 251',
    '--color-ink-secondary': '229 231 235',
    '--color-ink-muted': '156 163 175',
    '--color-ink-subtle': '107 114 128',
    '--color-ink-inverse': '17 24 39',
    '--color-edge-subtle': '55 65 81',
    '--color-edge': '55 65 81',
    '--color-edge-strong': '75 85 99',
    '--color-brand': '99 102 241',
    '--color-brand-fg': '17 24 39',
    '--color-danger': '248 113 113',
    '--color-warning': '251 191 36',
    '--color-caution': '251 146 60',
    '--color-success': '74 222 128',
    '--color-info': '96 165 250',
  },
} as const;
