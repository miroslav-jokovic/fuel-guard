import { ActivityIndicator, Pressable, View, type GestureResponderEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { AppText, type TextTone } from './AppText';
import { Icon } from './Icon';
import { haptics, type HapticKind } from '@/lib/haptics';
import { roleColors } from '@/theme/colors';
import { useTheme } from '@/theme/ThemeProvider';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

/**
 * `hero` is the amber pill that only ever appears ON the navy (D-DB2: amber is the one action
 * colour there). On the sheet the primary action is the navy pill instead, because an amber fill on
 * white is a warning, not a button. `soft` is gone — a tinted brand button was a third weight
 * nobody could rank against the other two.
 */
type Variant = 'primary' | 'hero' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

const VIEW: Record<Variant, string> = {
  primary: 'bg-brand active:bg-brand-pressed',
  hero: 'bg-action active:bg-action-pressed',
  // A hairline edge, because a white pill sitting on a white card had no outline at all — the
  // offer deck's Decline was a label floating in space until 2026-09-07.
  secondary: 'border border-edge bg-surface active:bg-surface-selected',
  danger: 'bg-danger active:opacity-90',
  ghost: 'active:bg-surface-muted',
};
/** The same variant on the navy: a white pill and a grey ghost both disappear there. */
const VIEW_ON_HERO: Partial<Record<Variant, string>> = {
  secondary: 'border border-hero-edge bg-hero-tile active:bg-hero-edge',
  ghost: 'active:bg-hero-tile',
};
const LABEL: Record<Variant, string> = {
  primary: 'text-brand-fg',
  hero: 'text-action-fg',
  secondary: 'text-ink',
  danger: 'text-ink-inverse',
  ghost: 'text-ink-secondary',
};
const LABEL_ON_HERO: Partial<Record<Variant, string>> = {
  secondary: 'text-on-hero',
  ghost: 'text-on-hero-secondary',
};
const LABEL_TONE: Record<Variant, TextTone> = {
  primary: 'inverse',
  hero: 'primary',
  secondary: 'primary',
  danger: 'inverse',
  ghost: 'secondary',
};
const LABEL_TONE_ON_HERO: Partial<Record<Variant, TextTone>> = {
  secondary: 'onHero',
  ghost: 'onHeroSecondary',
};
/** Pills at the three driver targets: 44 reachable, 48 routine, 56 driving-critical. */
const SIZE: Record<Size, { view: string; icon: number; gap: number }> = {
  sm: { view: 'min-h-11 rounded-full px-4', icon: 18, gap: 8 },
  md: { view: 'min-h-12 rounded-full px-5', icon: 20, gap: 8 },
  lg: { view: 'min-h-14 rounded-full px-6', icon: 22, gap: 10 },
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
  /** Set on a button drawn on the navy hero; only `secondary` and `ghost` change. */
  onHero?: boolean;
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
  onHero = false,
}: ButtonProps) {
  const { reduceMotion, themeKey } = useTheme();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const s = SIZE[size];
  const isDisabled = disabled || loading;
  const rc = roleColors[themeKey];
  const view = (onHero ? VIEW_ON_HERO[variant] : undefined) ?? VIEW[variant];
  const labelClass = (onHero ? LABEL_ON_HERO[variant] : undefined) ?? LABEL[variant];
  const labelTone = (onHero ? LABEL_TONE_ON_HERO[variant] : undefined) ?? LABEL_TONE[variant];
  const spinnerColor =
    variant === 'primary' || variant === 'danger'
      ? rc.inkInverse
      : variant === 'hero'
        ? rc.actionFg
        : onHero
          ? rc.onHero
          : rc.inkMuted;

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
        className={`items-center justify-center ${view} ${s.view} ${isDisabled ? 'opacity-50' : ''}`}
      >
        {/* Content keeps its layout while loading (opacity 0) — no width jump when the spinner shows. */}
        <View
          className="flex-row items-center"
          style={{ columnGap: s.gap, opacity: loading ? 0 : 1 }}
        >
          {icon ? <Icon name={icon} fill={iconFill} size={s.icon} className={labelClass} /> : null}
          <AppText variant="action" tone={labelTone} className="shrink text-center">{label}</AppText>
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
