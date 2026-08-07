import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { AppText } from './AppText';
import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const { reduceMotion } = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  const segmentWidth = trackWidth > 0 && options.length > 0 ? trackWidth / options.length : 0;
  const x = useSharedValue(0);

  useEffect(() => {
    if (segmentWidth <= 0) return;
    const target = index * segmentWidth;
    x.value = reduceMotion ? target : withSpring(target, { damping: 28, stiffness: 340 });
  }, [index, segmentWidth, x, reduceMotion]);

  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View className="rounded-lg border border-edge-subtle bg-surface-muted p-1">
      <View className="relative flex-row" onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}>
        {segmentWidth > 0 ? (
          <Animated.View
            className="absolute bottom-0 top-0 rounded-md border border-edge-subtle bg-surface"
            style={[{ width: segmentWidth }, thumbStyle]}
          />
        ) : null}
        {options.map((option) => {
          const active = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => {
                if (active) return;
                haptics.select();
                onChange(option.value);
              }}
              className="min-h-11 flex-1 items-center justify-center rounded-md px-2"
            >
              <AppText
                variant="supporting"
                tone={active ? 'primary' : 'muted'}
                className={active ? 'font-semibold' : 'font-medium'}
                numberOfLines={1}
              >
                {option.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
