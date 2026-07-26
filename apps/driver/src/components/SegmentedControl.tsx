import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { haptics } from '@/lib/haptics';

// iOS-17-style segmented control: an elevated thumb SLIDES between segments on the UI thread
// (spring, Reanimated) instead of a static background swap. Selection ticks haptically.
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const segmentWidth = trackWidth > 0 && options.length > 0 ? trackWidth / options.length : 0;
  const x = useSharedValue(0);

  useEffect(() => {
    if (segmentWidth > 0) {
      x.value = withSpring(index * segmentWidth, { damping: 24, stiffness: 300 });
    }
  }, [index, segmentWidth, x]);

  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View className="rounded-xl bg-surface-muted p-1">
      <View
        className="relative flex-row"
        onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      >
        {segmentWidth > 0 ? (
          <Animated.View
            className="absolute bottom-0 top-0 rounded-lg bg-surface shadow-sm"
            style={[{ width: segmentWidth }, thumbStyle]}
          />
        ) : null}
        {options.map((o) => {
          const active = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => {
                if (!active) {
                  haptics.select();
                  onChange(o.value);
                }
              }}
              className="min-h-[40px] flex-1 items-center justify-center rounded-lg"
            >
              <Text
                className={`text-sm ${active ? 'font-semibold text-ink' : 'font-medium text-ink-muted'}`}
              >
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
