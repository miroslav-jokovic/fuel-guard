import { Text, View } from 'react-native';

export type Tone = 'neutral' | 'brand' | 'danger' | 'caution' | 'warning' | 'success' | 'info';

const TONE: Record<Tone, { bg: string; text: string }> = {
  neutral: { bg: 'bg-surface-muted', text: 'text-ink-muted' },
  brand: { bg: 'bg-brand/10', text: 'text-brand' },
  danger: { bg: 'bg-danger/10', text: 'text-danger' },
  caution: { bg: 'bg-caution/10', text: 'text-caution' },
  warning: { bg: 'bg-warning/10', text: 'text-warning' },
  success: { bg: 'bg-success/10', text: 'text-success' },
  info: { bg: 'bg-info/10', text: 'text-info' },
};

// Severity → tone (mirrors apps/web/src/lib/badges.ts).
export function severityTone(sev: 'critical' | 'high' | 'medium' | 'low'): Tone {
  return sev === 'critical' ? 'danger' : sev === 'high' ? 'caution' : sev === 'medium' ? 'warning' : 'neutral';
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const t = TONE[tone];
  return (
    <View className={`self-start flex-row items-center rounded-md px-2 py-0.5 ${t.bg}`}>
      <Text className={`text-xs font-medium ${t.text}`}>{label}</Text>
    </View>
  );
}
