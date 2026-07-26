import { Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Icon } from './Icon';
import type { Tone } from './Badge';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

const FG: Record<Tone, string> = {
  neutral: 'text-ink-inverse', brand: 'text-brand', danger: 'text-danger',
  caution: 'text-caution', warning: 'text-warning', success: 'text-success', info: 'text-info',
};
const ICON: Record<Tone, MaterialSymbolName> = {
  neutral: 'info', brand: 'info', danger: 'error', caution: 'warning',
  warning: 'warning', success: 'check_circle', info: 'info',
};

// Presentational toast/snackbar (plan §22.3): inverse pill, tone icon (not an abstract dot),
// spring-in entrance. The imperative ToastHost lands with the loads flow.
export function Toast({ tone = 'success', message }: { tone?: Tone; message: string }) {
  return (
    <Animated.View
      entering={FadeInDown.springify().damping(18)}
      className="flex-row items-center gap-2.5 self-stretch rounded-xl bg-surface-inverse px-4 py-3.5"
      accessibilityRole="alert"
    >
      <Icon name={ICON[tone]} size={18} fill className={FG[tone]} />
      <Text className="flex-1 text-sm font-sans-md text-ink-inverse">{message}</Text>
    </Animated.View>
  );
}
