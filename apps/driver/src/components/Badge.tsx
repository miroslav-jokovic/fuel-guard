import { Text, View } from 'react-native';
import { Icon } from './Icon';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

export type Tone = 'neutral' | 'brand' | 'danger' | 'caution' | 'warning' | 'success' | 'info';

const TONE: Record<Tone, { bg: string; text: string; dot: string }> = {
  neutral: { bg: 'bg-surface-muted', text: 'text-ink-muted', dot: 'bg-ink-muted' },
  brand: { bg: 'bg-brand/10', text: 'text-brand', dot: 'bg-brand' },
  danger: { bg: 'bg-danger/10', text: 'text-danger', dot: 'bg-danger' },
  caution: { bg: 'bg-caution/10', text: 'text-caution', dot: 'bg-caution' },
  warning: { bg: 'bg-warning/10', text: 'text-warning', dot: 'bg-warning' },
  success: { bg: 'bg-success/10', text: 'text-success', dot: 'bg-success' },
  info: { bg: 'bg-info/10', text: 'text-info', dot: 'bg-info' },
};

// Severity → tone (mirrors apps/web/src/lib/badges.ts).
export function severityTone(sev: 'critical' | 'high' | 'medium' | 'low'): Tone {
  return sev === 'critical' ? 'danger' : sev === 'high' ? 'caution' : sev === 'medium' ? 'warning' : 'neutral';
}

// Pill status chip. Optional icon (never color alone — a11y + sunlight) and a `dot` accent for
// live states ("2 pending"). Rounded-full is the 2026 read for status.
export function Badge({
  label,
  tone = 'neutral',
  icon,
  dot = false,
}: {
  label: string;
  tone?: Tone;
  icon?: MaterialSymbolName;
  dot?: boolean;
}) {
  const t = TONE[tone];
  return (
    <View className={`flex-row items-center gap-1 self-start rounded-full px-2.5 py-[3px] ${t.bg}`}>
      {dot ? <View className={`h-1.5 w-1.5 rounded-full ${t.dot}`} /> : null}
      {icon ? <Icon name={icon} size={13} className={t.text} /> : null}
      <Text className={`text-xs font-sans-sb ${t.text}`}>{label}</Text>
    </View>
  );
}
