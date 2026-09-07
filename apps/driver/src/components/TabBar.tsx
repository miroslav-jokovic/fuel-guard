import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { AppText } from './AppText';
import { Icon } from './Icon';
import type { IconName } from '@/theme/hugeIcons';
import { haptics } from '@/lib/haptics';

const TAB_ICON: Record<string, IconName> = {
  home: 'home',
  // A bar chart for Loads was a stand-in: loads are trucks and freight, not analytics.
  loads: 'local_shipping',
  score: 'ranking',
  more: 'more_horiz',
};

/**
 * The tab shell is part of the navy world (D-DB1): a dark bar with 28pt top corners, so the sheet
 * above it and the shell below it read as one stacked surface rather than a white page sitting on a
 * white bar. Selection is carried by weight, colour AND a 6pt amber dot — never colour alone.
 */
export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const activeRoute = state.routes[state.index];
  const scoreIsHidden = activeRoute?.name === 'score'
    && (descriptors[activeRoute.key]?.options as { href?: unknown } | undefined)?.href === null;

  return (
    <View
      className="flex-row rounded-t-2xl bg-hero"
      style={{ paddingTop: 8, paddingBottom: Math.max(insets.bottom, 8) }}
    >
      {state.routes.map((route, index) => {
        const icon = TAB_ICON[route.name];
        if (!icon) return null;
        if ((descriptors[route.key]?.options as { href?: unknown } | undefined)?.href === null) return null;

        const focused = state.index === index || (route.name === 'more' && scoreIsHidden);
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
            className="min-h-13 flex-1 items-center justify-center gap-0.5 active:opacity-70"
            hitSlop={4}
          >
            <Icon
              name={icon}
              size={22}
              fill={focused}
              className={focused ? 'text-on-hero' : 'text-on-hero-muted'}
            />
            <AppText
              variant="caption"
              tone={focused ? 'onHero' : 'onHeroMuted'}
              className={focused ? 'font-ui-md' : ''}
              numberOfLines={1}
            >
              {label}
            </AppText>
            <View className={`mt-0.5 h-1.5 w-1.5 rounded-full ${focused ? 'bg-action' : 'bg-transparent'}`} />
          </Pressable>
        );
      })}
    </View>
  );
}
