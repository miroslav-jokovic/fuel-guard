import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs/types';
import { AppText } from './AppText';
import { Icon } from './Icon';
import type { IconName } from '@/theme/hugeIcons';
import { haptics } from '@/lib/haptics';

const TAB_ICON: Record<string, IconName> = {
  home: 'home',
  loads: 'analytics',
  score: 'ranking',
  more: 'more_horiz',
};

/** Stable four-item shell with visible labels, native-size glyphs, and a 52pt content target. */
export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      className="flex-row border-t border-edge-subtle bg-surface-raised"
      style={{ paddingTop: 5, paddingBottom: Math.max(insets.bottom, 6) }}
    >
      {state.routes.map((route, index) => {
        const icon = TAB_ICON[route.name];
        if (!icon) return null;
        if ((descriptors[route.key]?.options as { href?: unknown } | undefined)?.href === null) return null;

        const focused = state.index === index;
        const optionTitle = descriptors[route.key]?.options.title;
        const label = typeof optionTitle === 'string' ? optionTitle : route.name;

        const onPress = () => {
          haptics.select();
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        };

        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            onPress={onPress}
            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
            className="min-h-[52px] flex-1 items-center justify-center gap-0.5 active:opacity-70"
            hitSlop={4}
          >
            <Icon
              name={icon}
              size={22}
              fill={focused}
              className={focused ? 'text-brand' : 'text-ink-muted'}
            />
            <AppText
              variant="caption"
              tone={focused ? 'brand' : 'muted'}
              className={focused ? 'font-semibold' : ''}
              numberOfLines={1}
            >
              {label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}
