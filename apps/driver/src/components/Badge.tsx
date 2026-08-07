import { View } from 'react-native';
import { AppText } from './AppText';
import { Icon } from './Icon';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

export type Tone = 'neutral' | 'brand' | 'danger' | 'caution' | 'warning' | 'success' | 'info';

const TONE: Record<Tone, { bg: string; text: string; dot: string }> = {
  neutral: { bg: 'bg-surface-muted', text: 'text-ink-secondary', dot: 'bg-ink-muted' },
  brand: { bg: 'bg-brand-subtle', text: 'text-brand', dot: 'bg-brand' },
  danger: { bg: 'bg-danger/10', text: 'text-danger', dot: 'bg-danger' },
  caution: { bg: 'bg-caution/10', text: 'text-caution', dot: 'bg-caution' },
  warning: { bg: 'bg-warning/10', text: 'text-warning', dot: 'bg-warning' },
  success: { bg: 'bg-success/10', text: 'text-success', dot: 'bg-success' },
  info: { bg: 'bg-info/10', text: 'text-info', dot: 'bg-info' },
};

export function severityTone(sev: 'critical' | 'high' | 'medium' | 'low'): Tone {
  return sev === 'critical' ? 'danger' : sev === 'high' ? 'caution' : sev === 'medium' ? 'warning' : 'neutral';
}

/** Short categorical status only; never a replacement for hierarchy or explanatory copy. */
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
  const appearance = TONE[tone];
  return (
    <View className={`flex-row items-center gap-1 self-start rounded-full px-2 py-1 ${appearance.bg}`}>
      {dot ? <View className={`h-1.5 w-1.5 rounded-full ${appearance.dot}`} /> : null}
      {icon ? <Icon name={icon} size={13} className={appearance.text} /> : null}
      <AppText variant="caption" className={`font-semibold ${appearance.text}`}>{label}</AppText>
    </View>
  );
}
