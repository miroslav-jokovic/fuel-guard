import type { ColorSchemeName } from 'react-native';
import type { ThemeKey } from './colors';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ContrastMode = 'standard' | 'high' | 'system';

export const THEME_MODE_STORAGE_KEY = 'driver.theme-mode.v1';
export const CONTRAST_MODE_STORAGE_KEY = 'driver.contrast-mode.v1';

export function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function isContrastMode(value: string | null): value is ContrastMode {
  return value === 'standard' || value === 'high' || value === 'system';
}

export function resolveThemeKey(
  mode: ThemeMode,
  systemColorScheme: ColorSchemeName,
  contrastMode: ContrastMode,
  systemHighContrast: boolean,
): ThemeKey {
  const dark = mode === 'dark' || (mode === 'system' && systemColorScheme === 'dark');
  const highContrast = contrastMode === 'high' || (contrastMode === 'system' && systemHighContrast);

  if (highContrast) return dark ? 'highContrastDark' : 'highContrastLight';
  return dark ? 'dark' : 'light';
}
