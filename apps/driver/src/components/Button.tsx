import { ActivityIndicator, Pressable, View, type GestureResponderEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { AppText, type TextTone } from './AppText';
import { Icon } from './Icon';
import { haptics, type HapticKind } from '@/lib/haptics';
import { roleColors } from '@/theme/colors';
import { useTheme } from '@/theme/ThemeProvider';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

type Variant = 'primary' | 'secondary' | 'danger' | 'soft' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

const VIEW: Record<Variant, string> = {
  primary: 'bg-brand active:bg-brand-pressed',
  secondary: 'bg-surface border border-edge active:bg-surface-selected',
  danger: 'bg-danger active:opacity-90',
  soft: 'bg-brand-subtle active:opacity-80',
  ghost: 'active:bg-surface-muted',
};
const LABEL: Record<Variant, string> = {
  primary: 'text-brand-fg',
  secondary: 'text-ink',
  danger: 'text-ink-inverse',
  soft: 'text-brand',
  ghost: 'text-ink-secondary',
};
const LABEL_TONE: Record<Variant, TextTone> = {
  primary: 'inverse',
  secondary: 'primary',
  danger: 'inverse',
  soft: 'brand',
  ghost: 'secondary',
};
const SIZE: Record<Size, { view: string; text: string; icon: number; gap: number }> = {
  sm: { view: 'min-h-11 rounded-lg px-3', text: 'text-supporting', icon: 18, gap: 8 },
  md: { view: 'min-h-12 rounded-lg px-4', text: 'text-action', icon: 20, gap: 8 },
  lg: { view: 'min-h-14 rounded-lg px-5', text: 'text-nav', icon: 22, gap: 8 },
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
  const { reduceMotion, themeKey } = useTheme();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const s = SIZE[size];
  const isDisabled = disabled || loading;
  const rc = roleColors[themeKey];
  const spinnerColor = variant === 'primary' || variant === 'danger' ? rc.inkInverse : rc.inkMuted;

  return (
    <Animated.View style={animatedStyle} className={block ? 'w-full' : 'self-stretch'}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        disabled={isDisabled}
        onPressIn={() => {
          scale.value = reduceMotion ? 1 : withSpring(0.97, { damping: 24, stiffness: 380 });
        }}
        onPressOut={() => {
          scale.value = reduceMotion ? 1 : withSpring(1, { damping: 20, stiffness: 320 });
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
          <AppText variant="action" tone={LABEL_TONE[variant]} className={`shrink text-center ${s.text}`}>{label}</AppText>
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
