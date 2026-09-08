import { View } from 'react-native';
import { AppText } from './AppText';
import { TONE_SOLID, type Tone } from './tone';

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
          {label ? <AppText variant="supporting" tone="secondary" className="font-ui-md">{label}</AppText> : <View />}
          {detail ? <AppText variant="caption" tone="muted">{detail}</AppText> : null}
        </View>
      ) : null}
      <View className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
        <View className={`h-full rounded-full ${TONE_SOLID[tone]}`} style={{ width: `${percent}%` }} />
      </View>
    </View>
  );
}
