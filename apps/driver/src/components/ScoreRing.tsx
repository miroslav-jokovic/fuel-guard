import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { roleColors } from '@/theme/colors';
import { useTheme } from '@/theme/ThemeProvider';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// The performance hero: an animated progress ring that draws in on mount (UI-thread), with the
// big tabular numeral centered — the app's signature glanceable read (plan §22.8).
export function ScoreRing({
  score,
  max = 100,
  size = 148,
  strokeWidth = 12,
  sublabel,
}: {
  score: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  sublabel?: string;
}) {
  const { isDark } = useTheme();
  const rc = roleColors[isDark ? 'dark' : 'light'];
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const target = Math.min(Math.max(max > 0 ? score / max : 0, 0), 1);

  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(
      200,
      withTiming(target, { duration: 900, easing: Easing.out(Easing.cubic) }),
    );
  }, [target, progress]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - progress.value),
  }));

  return (
    <View
      style={{ width: size, height: size }}
      className="items-center justify-center"
      accessibilityRole="image"
      accessibilityLabel={`Score ${score} of ${max}`}
    >
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={rc.surfaceMuted}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={rc.brand}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          animatedProps={animatedProps}
          fill="none"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View className="absolute inset-0 items-center justify-center">
        <Text
          className="font-sans-bold text-ink"
          style={{
            fontSize: size * 0.3,
            lineHeight: size * 0.34,
            fontVariant: ['tabular-nums'],
            includeFontPadding: false,
          }}
        >
          {score}
        </Text>
        {sublabel ? <Text className="text-xs text-ink-muted">{sublabel}</Text> : null}
      </View>
    </View>
  );
}
