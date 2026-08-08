import { useEffect } from 'react';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '@/theme/ThemeProvider';

// Loading placeholder that BREATHES (opacity pulse on the UI thread) — a static gray block reads
// as "broken", a pulsing one reads as "loading". Cached-first screens use these, never spinners.
export function Skeleton({ className = '' }: { className?: string }) {
  const { reduceMotion } = useTheme();
  const opacity = useSharedValue(0.55);

  useEffect(() => {
    cancelAnimation(opacity);
    if (reduceMotion) {
      opacity.value = 0.72;
      return undefined;
    }
    opacity.value = withRepeat(
      withSequence(withTiming(1, { duration: 650 }), withTiming(0.55, { duration: 650 })),
      -1,
    );
    return () => cancelAnimation(opacity);
  }, [opacity, reduceMotion]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      className={`rounded-lg bg-surface-muted ${className}`}
      style={style}
      accessibilityElementsHidden
    />
  );
}
