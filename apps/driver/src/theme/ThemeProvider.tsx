import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo, View, useColorScheme as useSystemColorScheme } from 'react-native';
import { colorScheme, vars } from 'nativewind';
import { themeVars, type ThemeKey } from './colors';
import {
  resolveThemeKey,
  type ContrastMode,
  type ThemeMode,
} from './preferences';

interface ThemeContextValue {
  mode: ThemeMode;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
  contrastMode: ContrastMode;
  isHighContrast: boolean;
  setContrastMode: (mode: ContrastMode) => void;
  reduceMotion: boolean;
  boldText: boolean;
  themeKey: ThemeKey;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Follows platform appearance and accessibility preferences by default. Design System 2.0 keeps
 * those preferences in the theme context so primitives can remove nonessential motion, strengthen
 * separation, and avoid parallel platform checks scattered across components.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemColorScheme = useSystemColorScheme();
  const [mode, setMode] = useState<ThemeMode>('system');
  const [contrastMode, setContrastMode] = useState<ContrastMode>('system');
  const [systemHighContrast, setSystemHighContrast] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [boldText, setBoldText] = useState(false);

  useEffect(() => {
    colorScheme.set(mode);
  }, [mode]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      AccessibilityInfo.isHighTextContrastEnabled(),
      AccessibilityInfo.isReduceMotionEnabled(),
      AccessibilityInfo.isBoldTextEnabled(),
    ]).then(([highContrast, reduced, bold]) => {
      if (!active) return;
      setSystemHighContrast(highContrast);
      setReduceMotion(reduced);
      setBoldText(bold);
    });

    const subscriptions = [
      AccessibilityInfo.addEventListener('highTextContrastChanged', setSystemHighContrast),
      AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion),
      AccessibilityInfo.addEventListener('boldTextChanged', setBoldText),
    ];

    return () => {
      active = false;
      subscriptions.forEach((subscription) => subscription.remove());
    };
  }, []);

  const themeKey = resolveThemeKey(mode, systemColorScheme, contrastMode, systemHighContrast);
  const isDark = themeKey === 'dark' || themeKey === 'highContrastDark';
  const isHighContrast = themeKey === 'highContrastLight' || themeKey === 'highContrastDark';

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      isDark,
      setMode,
      contrastMode,
      isHighContrast,
      setContrastMode,
      reduceMotion,
      boldText,
      themeKey,
    }),
    [mode, isDark, contrastMode, isHighContrast, reduceMotion, boldText, themeKey],
  );

  return (
    <ThemeContext.Provider value={value}>
      <View style={[vars(themeVars[themeKey]), { flex: 1 }]}>{children}</View>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
