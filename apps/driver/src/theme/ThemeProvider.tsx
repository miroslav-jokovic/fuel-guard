import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { View, useColorScheme as useSystemColorScheme } from 'react-native';
import { colorScheme, vars } from 'nativewind';
import { themeVars } from './colors';

type Mode = 'light' | 'dark' | 'system';
interface ThemeContextValue {
  mode: Mode;
  isDark: boolean;
  setMode: (m: Mode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// Follows the device scheme by default; a manual override is exposed for the night-mode
// toggle drivers get in Settings (plan D23 / §22.8).
export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemColorScheme = useSystemColorScheme();
  const [mode, setMode] = useState<Mode>('system');
  const isDark = mode === 'dark' || (mode === 'system' && systemColorScheme === 'dark');

  useEffect(() => {
    colorScheme.set(mode);
  }, [mode]);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, isDark, setMode }),
    [mode, isDark],
  );

  return (
    <ThemeContext.Provider value={value}>
      <View style={[vars(themeVars[isDark ? 'dark' : 'light']), { flex: 1 }]}>{children}</View>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
