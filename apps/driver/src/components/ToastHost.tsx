import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Toast } from './Toast';
import type { Tone } from './tone';
import { motion } from '@/theme/tokens';

interface ToastContextValue {
  show: (message: string, tone?: Tone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Long enough to read a completion receipt, short enough not to sit over the next screen. */
const TOAST_MS = motion.deliberate * 10;

/**
 * `Toast` has existed since Design System 2.0 as a bare inline component with no way to present it,
 * which is exactly why no screen used one: a component you must mount yourself, above whatever is
 * already on screen, at the right offset, is a component nobody reaches for. The host makes it a
 * one-liner — `useToast().show('Stop completed · 2 photos queued')` — and it lives in the root
 * layout so the toast outlives the screen that raised it. Completing a stop navigates back; the
 * receipt has to survive that.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<{ message: string; tone: Tone; key: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, tone: Tone = 'success') => {
    if (timer.current) clearTimeout(timer.current);
    // A new toast REPLACES the one showing rather than queueing behind it: a driver who just did
    // two things wants to know about the second one.
    setToast({ message, tone, key: Date.now() });
    timer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? (
        <View
          className="absolute inset-x-0 bottom-0 px-5"
          style={{ paddingBottom: insets.bottom + 8 }}
          pointerEvents="box-none"
        >
          <Toast key={toast.key} tone={toast.tone} message={toast.message} />
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
