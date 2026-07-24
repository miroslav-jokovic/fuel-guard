import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'nativewind';

type Mode = 'light' | 'dark' | 'system';
type ThemeContextValue = { mode: Mode; isDark: boolean; setMode: (m: Mode) => void };

const ThemeContext = createContext<ThemeContextValue | null>(null);

// Follows the device scheme by default; a manual override is exposed for the night-mode
// toggle drivers get in Settings (plan D23 / §22.8).
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { colorScheme, setColorScheme } = useColorScheme();
  const [mode, setMode] = useState<Mode>('system');

  useEffect(() => {
    setColorScheme(mode);
  }, [mode, setColorScheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, isDark: colorScheme === 'dark', setMode }),
    [mode, colorScheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
