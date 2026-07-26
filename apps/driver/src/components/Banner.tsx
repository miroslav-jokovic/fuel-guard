import { Pressable, Text, View } from 'react-native';
import { Icon } from './Icon';
import type { Tone } from './Badge';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

const BG: Record<Tone, string> = {
  neutral: 'bg-surface-muted', brand: 'bg-brand/10', danger: 'bg-danger/10',
  caution: 'bg-caution/10', warning: 'bg-warning/10', success: 'bg-success/10', info: 'bg-info/10',
};
const FG: Record<Tone, string> = {
  neutral: 'text-ink-muted', brand: 'text-brand', danger: 'text-danger',
  caution: 'text-caution', warning: 'text-warning', success: 'text-success', info: 'text-info',
};
const ICON: Record<Tone, MaterialSymbolName> = {
  neutral: 'info', brand: 'info', danger: 'error', caution: 'warning',
  warning: 'warning', success: 'check_circle', info: 'info',
};

// Inline notice / offline banner. Icon + label (never color alone — a11y + sunlight), with an
// optional inline action ("Retry", "View") so a notice is never a dead-end.
export function Banner({
  tone = 'info',
  message,
  icon,
  actionLabel,
  onAction,
}: {
  tone?: Tone;
  message: string;
  icon?: MaterialSymbolName;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View
      className={`flex-row items-center gap-2.5 rounded-xl px-3.5 py-3 ${BG[tone]}`}
      accessibilityRole="alert"
    >
      <Icon name={icon ?? ICON[tone]} size={18} className={FG[tone]} />
      <Text className="flex-1 text-sm leading-snug text-ink-secondary">{message}</Text>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={onAction}
          className="min-h-[32px] justify-center"
        >
          <Text className={`text-sm font-semibold ${FG[tone]}`}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
