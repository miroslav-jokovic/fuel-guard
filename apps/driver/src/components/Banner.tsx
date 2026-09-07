import { Pressable, View } from 'react-native';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { TONE_ICON, TONE_SOFT, type Tone } from './tone';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

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
  const actionable = Boolean(actionLabel && onAction);
  return (
    <View
      className={`min-h-11 flex-row items-center gap-3 rounded-lg px-3 py-2 ${TONE_SOFT[tone].bg}`}
      accessible={!actionable}
      accessibilityRole={actionable ? undefined : 'alert'}
      accessibilityLiveRegion="polite"
    >
      <Icon name={icon ?? TONE_ICON[tone]} size={18} className={TONE_SOFT[tone].text} />
      <AppText variant="supporting" tone="secondary" className="flex-1">{message}</AppText>
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction} className="min-h-11 justify-center px-1">
          <AppText variant="action" className={TONE_SOFT[tone].text}>{actionLabel}</AppText>
        </Pressable>
      ) : null}
    </View>
  );
}
