import Animated, { FadeInDown } from 'react-native-reanimated';
import { AppText } from './AppText';
import { Icon } from './Icon';
import type { Tone } from './Badge';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';
import { useTheme } from '@/theme/ThemeProvider';

const FG: Record<Tone, string> = {
  neutral: 'text-ink-inverse', brand: 'text-brand', danger: 'text-danger',
  caution: 'text-caution', warning: 'text-warning', success: 'text-success', info: 'text-info',
};
const ICON: Record<Tone, MaterialSymbolName> = {
  neutral: 'info', brand: 'info', danger: 'error', caution: 'warning',
  warning: 'warning', success: 'check_circle', info: 'info',
};

export function Toast({ tone = 'success', message }: { tone?: Tone; message: string }) {
  const { reduceMotion } = useTheme();
  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeInDown.duration(160)}
      className="flex-row items-center gap-3 self-stretch rounded-lg bg-surface-inverse px-4 py-3"
      accessibilityRole="alert"
    >
      <Icon name={ICON[tone]} size={18} fill className={FG[tone]} />
      <AppText variant="supporting" tone="inverse" className="flex-1 font-medium">{message}</AppText>
    </Animated.View>
  );
}
