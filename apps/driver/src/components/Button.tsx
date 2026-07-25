import { ActivityIndicator, Pressable, Text, View, type GestureResponderEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Icon } from './Icon';
import { haptics, type HapticKind } from '@/lib/haptics';
import { roleColors } from '@/theme/colors';
import { useTheme } from '@/theme/ThemeProvider';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

type Variant = 'primary' | 'secondary' | 'danger' | 'soft' | 'ghost';
type Size = 'sm' | 'md';

const VIEW: Record<Variant, string> = {
  primary: 'bg-brand',
  secondary: 'bg-surface border border-edge-strong',
  danger: 'bg-danger',
  soft: 'bg-surface-muted',
  ghost: '',
};
const LABEL: Record<Variant, string> = {
  primary: 'text-brand-fg',
  secondary: 'text-ink-secondary',
  danger: 'text-ink-inverse',
  soft: 'text-ink-secondary',
  ghost: 'text-ink-muted',
};
const SIZE: Record<Size, { view: string; text: string; icon: number }> = {
  sm: { view: 'px-3 min-h-[44px] gap-1.5', text: 'text-sm', icon: 18 },
  md: { view: 'px-4 min-h-[52px] gap-2', text: 'text-base', icon: 20 },
};

export type ButtonProps = {
  label: string;
  variant?: Variant;
  size?: Size;
  icon?: MaterialSymbolName;
  iconFill?: boolean;
  loading?: boolean;
  disabled?: boolean;
  haptic?: HapticKind | null;
  onPress?: (e: GestureResponderEvent) => void;
  block?: boolean;
};

export function Button({
  label,
  variant = 'secondary',
  size = 'md',
  icon,
  iconFill = false,
  loading = false,
  disabled = false,
  haptic = 'tap',
  onPress,
  block = false,
}: ButtonProps) {
  const { isDark } = useTheme();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const s = SIZE[size];
  const isDisabled = disabled || loading;
  const spinnerColor =
    variant === 'primary' || variant === 'danger'
      ? roleColors[isDark ? 'dark' : 'light'].inkInverse
      : roleColors[isDark ? 'dark' : 'light'].inkMuted;

  return (
    <Animated.View style={animatedStyle} className={block ? 'w-full' : 'self-stretch'}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        disabled={isDisabled}
        onPressIn={() => {
          scale.value = withTiming(0.97, { duration: 90 });
        }}
        onPressOut={() => {
          scale.value = withTiming(1, { duration: 120 });
        }}
        onPress={(e) => {
          if (haptic) haptics[haptic]();
          onPress?.(e);
        }}
        className={`flex-row items-center justify-center rounded-md ${VIEW[variant]} ${s.view} ${isDisabled ? 'opacity-50' : ''}`}
      >
        {loading ? (
          <ActivityIndicator color={spinnerColor} />
        ) : (
          <View className="flex-row items-center" style={{ columnGap: size === 'sm' ? 6 : 8 }}>
            {icon ? <Icon name={icon} fill={iconFill} size={s.icon} className={LABEL[variant]} /> : null}
            <Text className={`font-semibold ${LABEL[variant]} ${s.text}`}>{label}</Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}
