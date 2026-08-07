import { View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs/types';
import { Icon } from './Icon';
import type { IconName } from '@/theme/hugeIcons';
import { haptics } from '@/lib/haptics';

/**
 * Custom bottom tab bar (replaces expo-router/unstable-native-tabs). Renders the app's HugeIcons
 * SVG through the shared `Icon` component, so tab-icon color follows the design tokens exactly —
 * no rasterized PNGs, no OS template-tint guessing, identical on iOS + Android. Native-quality
 * behaviors are reproduced explicitly: safe-area bottom inset, a light haptic on select, an
 * accessible tab role with selected state, and a filled/heavier glyph for the active tab.
 *
 * Driven by the standard React Navigation tabBar contract (state/descriptors/navigation) that
 * expo-router's <Tabs tabBar={...}> passes in.
 */
// Four tabs (D51). `navigate` is deliberately absent — D52 reserves the center slot without
// rendering it; the route is also `href: null` in the tabs layout, and this map is the second
// belt-and-braces skip (an unmapped route renders no tab).
const TAB_ICON: Record<string, IconName> = {
  home: 'home',
  loads: 'analytics',
  score: 'ranking',
  more: 'more_horiz',
};

// Bind to expo-router's OWN bottom-tabs props type (SDK 57 vendors its own copy, which differs from
// @react-navigation/bottom-tabs). `import type` is erased at build time, so the internal path costs
// nothing at runtime and matches exactly what <Tabs> passes to `tabBar`.
export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      className="flex-row border-t border-edge-subtle bg-surface"
      style={{ paddingTop: 8, paddingBottom: Math.max(insets.bottom, 8) }}
    >
      {state.routes.map((route, index) => {
        const icon = TAB_ICON[route.name];
        if (!icon) return null; // non-tab routes (if any) are not rendered in the bar
        const focused = state.index === index;
        const label =
          descriptors[route.key]?.options.title ?? route.name;

        const onPress = () => {
          haptics.select();
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        };
        const onLongPress = () => {
          navigation.emit({ type: 'tabLongPress', target: route.key });
        };

        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            onPress={onPress}
            onLongPress={onLongPress}
            className="flex-1 items-center justify-center active:opacity-70"
            style={{ minHeight: 44 }}
            hitSlop={8}
          >
            <Icon
              name={icon}
              size={30}
              fill={focused}
              className={focused ? 'text-brand' : 'text-ink-secondary'}
            />
          </Pressable>
        );
      })}
    </View>
  );
}
