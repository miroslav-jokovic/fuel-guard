import { ramps } from './ramps';

// Raw color values for the few RN/native APIs that take a color string (not className):
// tab-bar tint, ActivityIndicator, status bar. These live in src/theme (the only place the token
// linter allows raw color) so screens/layouts stay className-only.
export const roleColors = {
  light: {
    brand: ramps.brand[600],
    ink: ramps.neutral[900],
    inkMuted: ramps.neutral[500],
    inkInverse: '#ffffff',
    surface: '#ffffff',
    edge: ramps.neutral[200],
  },
  dark: {
    brand: ramps.brand[500],
    ink: ramps.neutral[50],
    inkMuted: ramps.neutral[400],
    inkInverse: ramps.neutral[900],
    surface: ramps.neutral[800],
    edge: ramps.neutral[700],
  },
} as const;
