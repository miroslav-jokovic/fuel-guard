import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { AppText } from './AppText';
import { Icon } from './Icon';
import {
  activeSlot,
  badgeLabel,
  discOffset,
  isHiddenTab,
  shell,
  shellBottomMargin,
  visibleTabs,
} from './tabBarModel';
import type { IconName } from '@/theme/hugeIcons';
import { shellElevation } from '@/theme/elevation';
import { useTheme } from '@/theme/ThemeProvider';
import { motion } from '@/theme/tokens';
import { haptics } from '@/lib/haptics';

/** The four tabs and their glyphs — owner's choice, 2026-09-07 (D-DB14). */
const TAB_ICON: Record<string, IconName> = {
  home: 'home',
  loads: 'delivery_truck',
  documents: 'folder',
  more: 'ellipsis',
};

/**
 * The floating tab shell (D-DB11).
 *
 * A capsule in the hero colour, inset from the screen edges and riding on the home indicator's
 * inset. The active tab's icon sits on an apricot disc raised through a canvas-coloured notch, so
 * the capsule reads as cut away around it. Selection is carried by the disc, the raised position,
 * the filled icon AND the bolder label — never colour alone (D-DB9).
 *
 * The disc does not travel. The first build slid it between slots on a spring, and the owner ruled
 * the motion "too much" the same day: a driver switching tabs wants the new screen, not a show.
 * Now the disc appears at the tapped slot with a 140ms fade and a 4% scale — enough to say
 * "this moved", not enough to watch (Reduce Motion drops even that).
 *
 * The container reserves `shell.rise` points of canvas above the capsule for the notch. That strip
 * is part of the bar's measured height, so the scene ends above it and no scrolled card ever passes
 * behind the ring. Every rule about which tabs draw and where the disc sits is `tabBarModel.ts`.
 */
export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { isDark, reduceMotion, themeKey } = useTheme();
  const [barWidth, setBarWidth] = useState(0);

  const visible = visibleTabs(state.routes, descriptors, TAB_ICON);
  const activeRoute = state.routes[state.index];
  const active = activeSlot(visible, activeRoute, isHiddenTab(descriptors[activeRoute?.key ?? '']?.options));
  const slotWidth = visible.length > 0 && barWidth > 0 ? barWidth / visible.length : 0;

  const pop = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) {
      pop.value = 1;
      return;
    }
    pop.value = 0;
    pop.value = withTiming(1, { duration: motion.fast });
  }, [active, reduceMotion, pop]);
  const popStyle = useAnimatedStyle(() => ({
    opacity: pop.value,
    transform: [{ scale: 0.96 + pop.value * 0.04 }],
  }));

  const activeIcon = active >= 0 ? TAB_ICON[visible[active]!.name] : null;
  const activeBadge = active >= 0 ? badgeLabel(descriptors[visible[active]!.key]?.options.tabBarBadge) : null;

  return (
    <View
      className="bg-canvas"
      style={{ paddingTop: shell.rise, paddingHorizontal: shell.inset, paddingBottom: shellBottomMargin(insets.bottom) }}
    >
      {/*
        * In the dark appearances the capsule steps UP to `hero-raised` with a hairline `hero-edge`:
        * the hero colour there is within a few points of the canvas, and a shadow cast onto a
        * near-black ground is nothing, so the shell read as an unlit strip on 2026-09-07's first
        * dark screenshot. Chosen from the theme key the tokens themselves resolve from, not a
        * `dark:` variant, so the shell and its tokens can never disagree about the appearance.
        */}
      <View
        className={`flex-row rounded-full border ${isDark ? 'border-hero-edge bg-hero-raised' : 'border-transparent bg-hero'}`}
        style={[{ height: shell.height }, shellElevation(themeKey)]}
        onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
      >
        {visible.map((route, index) => {
          const focused = index === active;
          const optionTitle = descriptors[route.key]?.options.title;
          const label = typeof optionTitle === 'string' ? optionTitle : route.name;
          const badge = badgeLabel(descriptors[route.key]?.options.tabBarBadge);

          const onPress = () => {
            haptics.select();
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
          };

          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityLabel={badge ? `${label}, ${badge} unread` : label}
              accessibilityState={{ selected: focused }}
              onPress={onPress}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
              className="flex-1 items-center"
              style={{ paddingTop: shell.iconTop }}
            >
              {/* The slot keeps its icon box so the label never moves; the disc carries the glyph
                  while this slot is active, and the box goes empty underneath it. */}
              <View className="h-6 w-6 items-center justify-center" style={{ opacity: focused ? 0 : 1 }}>
                <Icon name={TAB_ICON[route.name]!} size={22} className="text-on-hero-secondary" />
                {badge && !focused ? <SlotBadge label={badge} onDisc={false} /> : null}
              </View>
              {/*
                * `onHeroSecondary`, not `onHeroMuted`: a tab label is primary navigation read in
                * sunlight. No `numberOfLines`: Dynamic Type STACKS rather than truncates (D-DB9).
                */}
              <AppText
                variant="caption"
                tone={focused ? 'onHero' : 'onHeroSecondary'}
                className={`pt-1 text-center ${focused ? 'font-ui-sb' : ''}`}
              >
                {label}
              </AppText>
            </Pressable>
          );
        })}

        {slotWidth > 0 && activeIcon ? (
          <Animated.View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            className="absolute items-center justify-center rounded-full bg-canvas"
            style={[
              { width: shell.notch, height: shell.notch, top: -shell.rise, left: discOffset(active, slotWidth, shell.notch) },
              popStyle,
            ]}
          >
            <View
              className="items-center justify-center rounded-full bg-action"
              style={{ width: shell.disc, height: shell.disc }}
            >
              <Icon name={activeIcon} size={24} fill className="text-action-fg" />
              {activeBadge ? <SlotBadge label={activeBadge} onDisc /> : null}
            </View>
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The unread count. On the capsule it is an apricot pill so it reads against the hero; on the disc
 * it inverts to the hero colour, because apricot on apricot is nothing at all.
 */
function SlotBadge({ label, onDisc }: { label: string; onDisc: boolean }) {
  return (
    <View
      className={`absolute min-w-5 items-center justify-center rounded-full px-1 ${onDisc ? 'bg-hero' : 'bg-action'}`}
      style={onDisc ? { top: -2, right: -6, height: 20 } : { top: -8, right: -12, height: 20 }}
    >
      <AppText
        variant="caption"
        className={onDisc ? 'text-on-hero' : 'text-action-fg'}
        allowFontScaling={false}
        tabular
      >
        {label}
      </AppText>
    </View>
  );
}
