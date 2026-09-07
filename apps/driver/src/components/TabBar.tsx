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
/**
 * Is this a tab expo-router was told to hide with `href: null`?
 *
 * NOT by reading `options.href`, which is what this file did until 2026-09-07 and which could never
 * work: expo-router CONSUMES `href`, and by the time options reach a custom tab bar the key is gone
 * entirely — replaced by the `tabBarItemStyle` + `tabBarButton` pair its own bar uses to hide an
 * item. Measured, not assumed: an enabled tab's options are `["headerShown","title"]` and a hidden
 * one's are `["headerShown","tabBarItemStyle","tabBarButton"]`.
 *
 * The old test therefore matched nothing, and `loads` and `score` appeared in the bar whenever their
 * feature flag was off — labelled with their raw lowercase route names, because a hidden tab has no
 * `title` either. That is D-PM1 ("a feature an org turned off simply doesn't appear") failing in the
 * one place a driver would see it. `navigate` stayed hidden only by the accident of having no icon.
 */
function isHiddenTab(options: object | undefined): boolean {
  return options !== undefined && 'tabBarButton' in options;
}

export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const activeRoute = state.routes[state.index];
  const scoreIsHidden = activeRoute?.name === 'score'
    && isHiddenTab(descriptors[activeRoute.key]?.options);

  return (
    // The OUTER view exists only to colour what shows through the 28pt corners. A custom tab bar is
    // rendered outside the scene, so behind those corners is the navigator's own container — which
    // is stark white by default, and cut two cream notches into the navy shell. `canvas` is the
    // app's light ground, so the corners now read as the bar tucking under the page rather than as
    // two chips out of it (2026-09-07, seen on a simulator for the first time).
    <View className="bg-canvas">
      <View
        className="flex-row rounded-t-2xl bg-hero"
        style={{ paddingTop: 8, paddingBottom: Math.max(insets.bottom, 8) }}
      >
      {state.routes.map((route, index) => {
        const icon = TAB_ICON[route.name];
        if (!icon) return null;
        if (isHiddenTab(descriptors[route.key]?.options)) return null;

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
    </View>
  );
}
