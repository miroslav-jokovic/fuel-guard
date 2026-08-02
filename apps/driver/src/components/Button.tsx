import { ActivityIndicator, Pressable, Text, View, type GestureResponderEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Icon } from './Icon';
import { haptics, type HapticKind } from '@/lib/haptics';
import { roleColors } from '@/theme/colors';
import { useTheme } from '@/theme/ThemeProvider';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

type Variant = 'primary' | 'secondary' | 'danger' | 'soft' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

const VIEW: Record<Variant, string> = {
  primary: 'bg-brand shadow-sm active:opacity-90',
  secondary: 'bg-surface border border-edge-strong shadow-sm active:bg-surface-subtle',
  danger: 'bg-danger shadow-sm active:opacity-90',
  soft: 'bg-surface-muted active:bg-surface-subtle',
  ghost: 'active:bg-surface-muted',
};
const LABEL: Record<Variant, string> = {
  primary: 'text-brand-fg',
  secondary: 'text-ink',
  danger: 'text-ink-inverse',
  soft: 'text-ink-secondary',
  ghost: 'text-ink-secondary',
};
// 2026 sizing: roomier targets, 12px radius on md/lg (radius token xl), 56pt CTA tier (plan target.cta).
const SIZE: Record<Size, { view: string; text: string; icon: number; gap: number }> = {
  sm: { view: 'px-3.5 min-h-[44px] rounded-lg', text: 'text-sm', icon: 18, gap: 6 },
  md: { view: 'px-5 min-h-[52px] rounded-xl', text: 'text-base', icon: 20, gap: 8 },
  lg: { view: 'px-6 min-h-14 rounded-xl', text: 'text-cta', icon: 22, gap: 8 },
};

export interface ButtonProps {
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
}

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
  const rc = roleColors[isDark ? 'dark' : 'light'];
  const spinnerColor = variant === 'primary' || variant === 'danger' ? rc.inkInverse : rc.inkMuted;

  return (
    <Animated.View style={animatedStyle} className={block ? 'w-full' : 'self-stretch'}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        disabled={isDisabled}
        onPressIn={() => {
          scale.value = withSpring(0.97, { damping: 24, stiffness: 380 });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { damping: 20, stiffness: 320 });
        }}
        onPress={(e) => {
          if (haptic) haptics[haptic]();
          onPress?.(e);
        }}
        className={`items-center justify-center ${VIEW[variant]} ${s.view} ${isDisabled ? 'opacity-50' : ''}`}
      >
        {/* Content keeps its layout while loading (opacity 0) — no width jump when the spinner shows. */}
        <View
          className="flex-row items-center"
          style={{ columnGap: s.gap, opacity: loading ? 0 : 1 }}
        >
          {icon ? <Icon name={icon} fill={iconFill} size={s.icon} className={LABEL[variant]} /> : null}
          <Text className={`font-sans-sb ${LABEL[variant]} ${s.text}`}>{label}</Text>
        </View>
        {loading ? (
          <View className="absolute inset-0 items-center justify-center">
            <ActivityIndicator color={spinnerColor} />
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}
