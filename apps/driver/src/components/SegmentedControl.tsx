import { useEffect, useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';
import { layout } from '@/theme/tokens';

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
  const { fontScale } = useWindowDimensions();
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

  if (fontScale >= layout.largeTextBreakpoint) {
    return (
      <View className="overflow-hidden rounded-lg border border-edge-subtle bg-surface">
        {options.map((option, optionIndex) => {
          const active = option.value === value;
          return (
            <View key={option.value}>
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                onPress={() => {
                  if (active) return;
                  haptics.select();
                  onChange(option.value);
                }}
                className={`min-h-12 flex-row items-center gap-3 px-4 py-2 ${active ? 'bg-surface-selected' : 'bg-surface'}`}
              >
                <AppText variant="body" className={`flex-1 ${active ? 'font-semibold' : ''}`}>
                  {option.label}
                </AppText>
                <Icon
                  name={active ? 'radio_button_checked' : 'radio_button_unchecked'}
                  size={20}
                  className={active ? 'text-brand' : 'text-ink-muted'}
                />
              </Pressable>
              {optionIndex < options.length - 1 ? <View className="ml-4 h-px bg-edge-subtle" /> : null}
            </View>
          );
        })}
      </View>
    );
  }

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
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
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
