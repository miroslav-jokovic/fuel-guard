import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { AppText } from './AppText';
import { Icon } from './Icon';
import type { IconName } from '@/theme/hugeIcons';
import { haptics } from '@/lib/haptics';

const TAB_ICON: Record<string, IconName> = {
  // A calendar page, not a house. The tab is labelled "Today" and opens a day sheet; a house says
  // "home screen", which is a website's idea, not a driver's. This is the same argument the next
  // line already makes about Loads — applied to the tab that was still getting it wrong.
  home: 'calendar_today',
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
    // What shows through the 28pt corners is the navigator's own container, which is stark white by
    // default — so the corners cut two notches out of the shell. `canvas` is the app's light ground
    // and matches the sheet that now runs all the way down to this bar (see Screen.tsx, where the
    // bottom inset moved inside the sheet), so the corners read as the bar tucking under the page.
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
            onPress={onPress}
            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
            className="min-h-13 flex-1 items-center justify-center gap-1 active:opacity-70"
            hitSlop={4}
          >
            <Icon
              name={icon}
              size={22}
              fill={focused}
              className={focused ? 'text-on-hero' : 'text-on-hero-secondary'}
            />
            {/*
              * `onHeroSecondary`, not `onHeroMuted`. The token contract restricts `on-hero-muted` to
              * "non-essential copy (axis labels, timestamps)" and requires anything a driver must
              * read on the hero to use `on-hero` or `on-hero-secondary`. A tab label is the app's
              * primary navigation, read in sunlight, and was the one place that rule was broken.
              *
              * No `numberOfLines`: D-DB9 says Dynamic Type STACKS rather than truncates, and at
              * large text "Loads" and "Score" were the only labels in the app clipped to fit.
              */}
            <AppText
              variant="caption"
              tone={focused ? 'onHero' : 'onHeroSecondary'}
              className={focused ? 'font-ui-md' : ''}
            >
              {label}
            </AppText>
            <View className={`mt-1 h-1.5 w-1.5 rounded-full ${focused ? 'bg-action' : 'bg-transparent'}`} />
          </Pressable>
        );
        })}
      </View>
    </View>
  );
}
