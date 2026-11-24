import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { AppText, type TextTone } from './AppText';
import { Icon } from './Icon';
import { NativeSegmented } from './NativeSegmented';
import { haptics } from '@/lib/haptics';
import { layout } from '@/theme/tokens';

/**
 * Two shapes, one control. `thumb` is the system's own segmented control (Visual 2026 V9, D-DV1:
 * `NativeSegmented`, Liquid Glass on iOS 26, Material 3 on Android) for a small closed set of
 * appearance choices; at the largest text sizes, where segments would truncate, it becomes a list.
 * `chips` is the Direction B filter rail: a scrolling row of pills that can carry a count and can sit
 * on the navy hero, where a bordered track disappears. No system control does that, so it is drawn.
 *
 * Both keep `role="radio"` and `checked`, because a chip rail is still a single choice.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  variant = 'thumb',
  onHero = false,
}: {
  options: { label: string; value: T; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  variant?: 'thumb' | 'chips';
  onHero?: boolean;
}) {
  const { fontScale } = useWindowDimensions();

  if (variant === 'chips') {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="flex-row gap-2"
        accessibilityRole="radiogroup"
      >
        {options.map((option) => {
          const active = option.value === value;
          const fill = active
            ? 'bg-action'
            : onHero
              ? 'bg-on-hero/10'
              : 'bg-surface-muted';
          const textTone: TextTone = active ? 'onAction' : onHero ? 'onHero' : 'secondary';
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
              className={`min-h-9 flex-row items-center justify-center gap-1 rounded-full px-4 ${fill}`}
            >
              <AppText weight="medium" variant="supporting" tone={textTone} numberOfLines={1}>
                {option.label}
              </AppText>
              {option.count != null ? (
                <AppText weight="medium" variant="supporting" tone={textTone} tabular>
                  {option.count}
                </AppText>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    );
  }

  if (fontScale >= layout.largeTextBreakpoint) {
    return (
      <View className="overflow-hidden rounded-lg bg-surface">
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
                <AppText weight={active ? 'semibold' : undefined} variant="body" className="flex-1">
                  {option.label}
                </AppText>
                <Icon
                  name={active ? 'radio_button_checked' : 'radio_button_unchecked'}
                  size={20}
                  className={active ? 'text-action-ink' : 'text-ink-muted'}
                />
              </Pressable>
              {optionIndex < options.length - 1 ? <View className="ml-4 h-px bg-edge-subtle" /> : null}
            </View>
          );
        })}
      </View>
    );
  }

  return <NativeSegmented options={options} value={value} onChange={onChange} />;
}
