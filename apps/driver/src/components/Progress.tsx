import { Text, View } from 'react-native';
import type { Tone } from './Badge';

const BAR: Record<Tone, string> = {
  neutral: 'bg-ink-muted',
  brand: 'bg-brand',
  danger: 'bg-danger',
  caution: 'bg-caution',
  warning: 'bg-warning',
  success: 'bg-success',
  info: 'bg-info',
};

export function Progress({
  value,
  label,
  detail,
  tone = 'brand',
}: {
  value: number;
  label?: string;
  detail?: string;
  tone?: Tone;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  const percent = Math.round(clamped * 100);
  return (
    <View className="gap-1.5" accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percent }}>
      {label || detail ? (
        <View className="flex-row items-center justify-between gap-3">
          {label ? <Text className="text-sm font-sans-md text-ink-secondary">{label}</Text> : <View />}
          {detail ? <Text className="text-xs text-ink-muted">{detail}</Text> : null}
        </View>
      ) : null}
      <View className="h-2 overflow-hidden rounded-full bg-surface-muted">
        <View className={`h-full rounded-full ${BAR[tone]}`} style={{ width: `${percent}%` }} />
      </View>
    </View>
  );
}
