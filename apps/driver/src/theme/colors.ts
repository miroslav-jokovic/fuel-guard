import { ramps } from './ramps';

// Raw color values for the few RN/native APIs that take a color string (not className):
// tab-bar tint, ActivityIndicator, status bar, and SVG strokes/fills (react-native-svg has no
// className). These live in src/theme (the only place the token linter allows raw color) so
// screens/components stay className-only. Values mirror the global.css role map exactly.
export const roleColors = {
  light: {
    brand: ramps.brand[600],
    ink: ramps.neutral[900],
    inkMuted: ramps.neutral[500],
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
    inkMuted: ramps.neutral[400],
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
