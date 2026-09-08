import { Pressable, View } from 'react-native';
import { AppText, TEXT_TONE_CLASS } from './AppText';
import { haptics } from '@/lib/haptics';
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
  return (
    <View
      className={`min-h-11 flex-row items-center gap-3 rounded-lg px-3 py-2 ${TONE_SOFT[tone].bg}`}
      // `accessible={!actionable}` made the ONE kind of banner that matters — an error with a
      // recovery action — the one kind VoiceOver never announced, because `accessibilityLiveRegion`
      // is Android-only. The container announces itself and its children stay reachable.
      accessible={false}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Icon name={icon ?? TONE_ICON[tone]} size={18} className={TEXT_TONE_CLASS[TONE_SOFT[tone].textTone]} />
      <AppText variant="supporting" tone={TONE_SOFT[tone].textTone} className="flex-1">{message}</AppText>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          // px-3, not px-1: this is the recovery tap, and it sat as a ~40pt strip at the screen
          // edge. Haptic to match every other pressable in the app — a driver in a dead zone needs
          // to know the tap landed.
          onPress={() => {
            haptics.select();
            onAction();
          }}
          className="min-h-11 justify-center px-3"
        >
          <AppText variant="action" tone={TONE_SOFT[tone].textTone}>{actionLabel}</AppText>
        </Pressable>
      ) : null}
    </View>
  );
}
