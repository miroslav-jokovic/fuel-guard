import Animated, { FadeInDown } from 'react-native-reanimated';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { TONE_ICON, type Tone } from './tone';
import { useTheme } from '@/theme/ThemeProvider';

/** A toast is drawn on the inverse surface, so its glyph uses the light-on-dark foregrounds. */
const FG: Record<Tone, string> = {
  neutral: 'text-ink-inverse', brand: 'text-accent', action: 'text-action', danger: 'text-danger',
  caution: 'text-caution', warning: 'text-warning', success: 'text-success', info: 'text-accent',
  ghost: 'text-ink-inverse',
};

export function Toast({ tone = 'success', message }: { tone?: Tone; message: string }) {
  const { reduceMotion } = useTheme();
  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeInDown.duration(160)}
      className="flex-row items-center gap-3 self-stretch rounded-lg bg-surface-inverse px-4 py-3"
      accessibilityRole="alert"
    >
      <Icon name={TONE_ICON[tone]} size={18} fill className={FG[tone]} />
      <AppText variant="supporting" tone="inverse" className="flex-1 font-ui-md">{message}</AppText>
    </Animated.View>
  );
}
