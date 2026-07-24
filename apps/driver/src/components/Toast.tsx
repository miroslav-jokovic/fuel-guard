import { Text, View } from 'react-native';
import type { Tone } from './Badge';

const DOT: Record<Tone, string> = {
  neutral: 'bg-ink-subtle',
  brand: 'bg-brand',
  danger: 'bg-danger',
  caution: 'bg-caution',
  warning: 'bg-warning',
  success: 'bg-success',
  info: 'bg-info',
};

// Presentational toast/snackbar (plan §22.3). The imperative ToastHost lands with capture (Phase 3).
export function Toast({ tone = 'success', message }: { tone?: Tone; message: string }) {
  return (
    <View className="flex-row items-center gap-2 rounded-lg bg-surface-inverse px-4 py-3" accessibilityRole="alert">
      <View className={`w-2 h-2 rounded-full ${DOT[tone]}`} />
      <Text className="flex-1 text-sm font-medium text-ink-inverse">{message}</Text>
    </View>
  );
}
