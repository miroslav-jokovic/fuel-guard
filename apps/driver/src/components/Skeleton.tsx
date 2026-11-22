import { useEffect } from 'react';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';

// Loading placeholder that BREATHES (opacity pulse on the UI thread) — a static gray block reads
// as "broken", a pulsing one reads as "loading". Cached-first screens use these, never spinners.
export function Skeleton({ className = '', style: outer }: { className?: string; style?: ViewStyle }) {
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
      style={[style, outer]}
      accessibilityElementsHidden
    />
  );
}

/**
 * Rows loading: the shape the content will take, a glyph and two lines on the canvas, never a stack of
 * rounded cards (D-DV7, D-DV14). The V9 critique caught Notifications, Messages, Loads, Documents and
 * check-in loading as card stacks under rows that are not cards. Block skeletons stay only where the
 * content IS the one raised signature block.
 */
export function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <View key={index} className="min-h-14 flex-row items-center gap-3 px-4 py-3">
          <Skeleton className="h-6 w-6 rounded-md" />
          <View className="flex-1 gap-2">
            <Skeleton className="h-4 w-3/5 rounded-md" />
            <Skeleton className="h-3 w-2/5 rounded-md" />
          </View>
        </View>
      ))}
    </>
  );
}
