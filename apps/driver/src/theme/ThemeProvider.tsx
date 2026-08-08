import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, View, useColorScheme as useSystemColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { colorScheme, vars } from 'nativewind';
import { themeVars, type ThemeKey } from './colors';
import {
  CONTRAST_MODE_STORAGE_KEY,
  THEME_MODE_STORAGE_KEY,
  isContrastMode,
  isThemeMode,
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
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [contrastMode, setContrastModeState] = useState<ContrastMode>('system');
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [systemHighContrast, setSystemHighContrast] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [boldText, setBoldText] = useState(false);

  useEffect(() => {
    let active = true;
    const fallback = setTimeout(() => {
      if (active) setPreferencesReady(true);
    }, 250);
    void AsyncStorage.multiGet([THEME_MODE_STORAGE_KEY, CONTRAST_MODE_STORAGE_KEY])
      .then((entries) => {
        if (!active) return;
        const stored = new Map(entries);
        const storedMode = stored.get(THEME_MODE_STORAGE_KEY) ?? null;
        const storedContrast = stored.get(CONTRAST_MODE_STORAGE_KEY) ?? null;
        if (isThemeMode(storedMode)) setModeState(storedMode);
        if (isContrastMode(storedContrast)) setContrastModeState(storedContrast);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          clearTimeout(fallback);
          setPreferencesReady(true);
        }
      });
    return () => {
      active = false;
      clearTimeout(fallback);
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void AsyncStorage.setItem(THEME_MODE_STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const setContrastMode = useCallback((next: ContrastMode) => {
    setContrastModeState(next);
    void AsyncStorage.setItem(CONTRAST_MODE_STORAGE_KEY, next).catch(() => undefined);
  }, []);

  useEffect(() => {
    colorScheme.set(mode);
  }, [mode]);

  useEffect(() => {
    let active = true;
    const contrastPreference =
      Platform.OS === 'ios'
        ? AccessibilityInfo.isDarkerSystemColorsEnabled().catch(() => false)
        : Platform.OS === 'android'
          ? AccessibilityInfo.isHighTextContrastEnabled().catch(() => false)
          : Promise.resolve(false);
    const boldTextPreference =
      Platform.OS === 'ios' ? AccessibilityInfo.isBoldTextEnabled().catch(() => false) : Promise.resolve(false);

    void Promise.all([
      contrastPreference,
      AccessibilityInfo.isReduceMotionEnabled().catch(() => false),
      boldTextPreference,
    ]).then(([highContrast, reduced, bold]) => {
      if (!active) return;
      setSystemHighContrast(highContrast);
      setReduceMotion(reduced);
      setBoldText(bold);
    });

    const subscriptions = [
      AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion),
    ];
    if (Platform.OS === 'ios') {
      subscriptions.push(AccessibilityInfo.addEventListener('boldTextChanged', setBoldText));
      subscriptions.push(AccessibilityInfo.addEventListener('darkerSystemColorsChanged', setSystemHighContrast));
    } else if (Platform.OS === 'android') {
      subscriptions.push(AccessibilityInfo.addEventListener('highTextContrastChanged', setSystemHighContrast));
    }

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
    [mode, setMode, isDark, contrastMode, setContrastMode, isHighContrast, reduceMotion, boldText, themeKey],
  );

  return (
    <ThemeContext.Provider value={value}>
      <View style={[vars(themeVars[themeKey]), { flex: 1 }]}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        {preferencesReady ? children : null}
      </View>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
