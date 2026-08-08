import { View } from 'react-native';
import { AppText } from './AppText';
import type { Tone } from './Badge';

const BAR: Record<Tone, string> = {
  neutral: 'bg-ink-muted', brand: 'bg-brand', danger: 'bg-danger', caution: 'bg-caution',
  warning: 'bg-warning', success: 'bg-success', info: 'bg-info',
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
    <View className="gap-2" accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percent }}>
      {label || detail ? (
        <View className="flex-row items-center justify-between gap-3">
          {label ? <AppText variant="supporting" tone="secondary" className="font-medium">{label}</AppText> : <View />}
          {detail ? <AppText variant="caption" tone="muted">{detail}</AppText> : null}
        </View>
      ) : null}
      <View className="h-1 overflow-hidden rounded-full bg-surface-muted">
        <View className={`h-full rounded-full ${BAR[tone]}`} style={{ width: `${percent}%` }} />
      </View>
    </View>
  );
}
