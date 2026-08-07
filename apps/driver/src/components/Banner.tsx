import { Pressable, View } from 'react-native';
import { AppText } from './AppText';
import { Icon } from './Icon';
import type { Tone } from './Badge';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

const BG: Record<Tone, string> = {
  neutral: 'bg-surface-muted', brand: 'bg-brand-subtle', danger: 'bg-danger/10',
  caution: 'bg-caution/10', warning: 'bg-warning/10', success: 'bg-success/10', info: 'bg-info/10',
};
const FG: Record<Tone, string> = {
  neutral: 'text-ink-secondary', brand: 'text-brand', danger: 'text-danger',
  caution: 'text-caution', warning: 'text-warning', success: 'text-success', info: 'text-info',
};
const ICON: Record<Tone, MaterialSymbolName> = {
  neutral: 'info', brand: 'info', danger: 'error', caution: 'warning',
  warning: 'warning', success: 'check_circle', info: 'info',
};

/** Compact status strip with a full-size optional action. */
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
      className={`min-h-11 flex-row items-center gap-2.5 rounded-lg border border-edge-subtle px-3 py-2 ${BG[tone]}`}
      accessibilityRole="alert"
    >
      <Icon name={icon ?? ICON[tone]} size={18} className={FG[tone]} />
      <AppText variant="supporting" tone="secondary" className="flex-1">{message}</AppText>
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction} className="min-h-11 justify-center px-1">
          <AppText variant="action" className={FG[tone]}>{actionLabel}</AppText>
        </Pressable>
      ) : null}
    </View>
  );
}
