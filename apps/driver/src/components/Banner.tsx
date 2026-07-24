import { Text, View } from 'react-native';
import type { Tone } from './Badge';

const BG: Record<Tone, string> = {
  neutral: 'bg-surface-muted',
  brand: 'bg-brand/10',
  danger: 'bg-danger/10',
  caution: 'bg-caution/10',
  warning: 'bg-warning/10',
  success: 'bg-success/10',
  info: 'bg-info/10',
};
const DOT: Record<Tone, string> = {
  neutral: 'bg-ink-subtle',
  brand: 'bg-brand',
  danger: 'bg-danger',
  caution: 'bg-caution',
  warning: 'bg-warning',
  success: 'bg-success',
  info: 'bg-info',
};

// Inline notice / offline banner (plan §22.3). Icon(dot) + label — never color alone (a11y).
export function Banner({ tone = 'info', message }: { tone?: Tone; message: string }) {
  return (
    <View className={`flex-row items-center gap-2 rounded-md px-3 py-2 ${BG[tone]}`} accessibilityRole="alert">
      <View className={`w-2 h-2 rounded-full ${DOT[tone]}`} />
      <Text className="flex-1 text-sm text-ink-secondary">{message}</Text>
    </View>
  );
}
