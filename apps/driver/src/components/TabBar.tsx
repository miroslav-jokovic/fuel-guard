import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { AppText } from './AppText';
import { Icon } from './Icon';
import {
  activeSlot,
  badgeLabel,
  discOffset,
  isHiddenTab,
  capsulePath,
  shell,
  shellBottomMargin,
  visibleTabs,
} from './tabBarModel';
import type { IconName } from '@/theme/hugeIcons';
import { roleColors } from '@/theme/colors';
import { useTheme } from '@/theme/ThemeProvider';
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
 * The disc does not animate. The first build slid it between slots on a spring, the second faded
 * it in, and the owner ruled both "too much" the same day: a driver switching tabs wants the new
 * screen, not a show. The disc is simply drawn at the active slot, and the tab scene itself
 * switches without a transition (`animation: 'none'` in the layout).
 *
 * The container reserves `shell.rise` points of canvas above the capsule for the notch. That strip
 * is part of the bar's measured height, so the scene ends above it and no scrolled card ever passes
 * behind the ring. Every rule about which tabs draw and where the disc sits is `tabBarModel.ts`.
 */
export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { isDark, themeKey } = useTheme();
  const [barWidth, setBarWidth] = useState(0);

  const visible = visibleTabs(state.routes, descriptors, TAB_ICON);
  const activeRoute = state.routes[state.index];
  const active = activeSlot(visible, activeRoute, isHiddenTab(descriptors[activeRoute?.key ?? '']?.options));
  const slotWidth = visible.length > 0 && barWidth > 0 ? barWidth / visible.length : 0;

  const activeIcon = active >= 0 ? TAB_ICON[visible[active]!.name] : null;
  const activeBadge = active >= 0 ? badgeLabel(descriptors[visible[active]!.key]?.options.tabBarBadge) : null;

  return (
    <View
      // TRANSPARENT, and floating over the scene (owner ruling 2026-09-08, amending D-DB11).
      //
      // It was `bg-canvas`, an opaque band the scene ended above. D-DB11's reasoning for that was
      // the notch: a canvas-coloured ring behind the disc reads as CUT OUT of the capsule, and the
      // band guaranteed the ring always had canvas behind it. The cost, which only shows once you
      // scroll, is that every screen's content is CHOPPED by a hard cream edge — a white card
      // meeting the band mid-row reads as a rendering fault, and mid-scroll is the common case.
      // A bar that content passes under reads as a bar; a band that cuts content reads as broken.
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingTop: shell.rise,
        paddingHorizontal: shell.inset,
        paddingBottom: shellBottomMargin(insets.bottom),
      }}
    >
      {/*
        * In the dark appearances the capsule steps UP to `hero-raised` with a hairline `hero-edge`:
        * the hero colour there is within a few points of the canvas, and a shadow cast onto a
        * near-black ground is nothing, so the shell read as an unlit strip on 2026-09-07's first
        * dark screenshot. Chosen from the theme key the tokens themselves resolve from, not a
        * `dark:` variant, so the shell and its tokens can never disagree about the appearance.
        */}
      <View
        className="flex-row"
        /*
         * NO RN SHADOW on this view, and that is forced rather than chosen.
         *
         * `shellElevation` was an RN shadow on a view with no backgroundColor, so iOS derived it
         * from the layer's alpha — which is what made it follow the holed capsule for free, and also
         * what made it bleed INTO the hole. Measured on the More tab: the 5pt gap read rgb(232,231,230)
         * against a page of rgb(252,251,250), so the gap that exists to show the page showed a grey
         * ring instead. You cannot have both an alpha-derived shadow and a clean hole; the hole wins,
         * because it is the stronger depth cue — a bar you can see the page THROUGH cannot read as
         * "a dark bar painted on the page", which is the whole thing D-DB11's shadow was there to
         * prevent. With it gone the same gap reads rgb(250,248,245): the page, within two levels.
         */
        style={{ height: shell.height }}
        onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
      >
        {/*
          * The capsule is DRAWN, not a background colour, because it has a hole in it — see
          * `capsulePath`. A View cannot be a shape with a hole, and the hole is the whole point: it
          * is what lets the page show between the disc and the bar.
          *
          * The shadow stays an RN shadow on the parent rather than an SVG filter. With no
          * backgroundColor on that view, iOS derives the shadow from the layer's alpha — which is
          * this path, hole included — so it follows the real silhouette for free.
          */}
        {barWidth > 0 ? (
          <Svg
            pointerEvents="none"
            style={{ position: 'absolute', top: 0, left: 0 }}
            width={barWidth}
            height={shell.height}
          >
            <Path
              d={capsulePath(
                barWidth,
                shell.height,
                activeIcon && slotWidth > 0
                  ? discOffset(active, slotWidth, shell.notch) + shell.notch / 2
                  : -shell.notch,
                shell.notch / 2,
              )}
              fill={isDark ? roleColors[themeKey].heroRaised : roleColors[themeKey].hero}
              fillRule="evenodd"
              /*
               * The dark appearances' hairline, which was `border-hero-edge` while the capsule was a
               * View. It is not decoration there: `hero-raised` sits within a few points of the dark
               * canvas, so without it the shell is an unlit strip — the same finding D-DB11 recorded
               * from the first dark screenshot. A stroke on the path also traces the hole, which a
               * border never could.
               */
              stroke={isDark ? roleColors[themeKey].heroEdge : 'none'}
              strokeWidth={isDark ? 1 : 0}
            />
          </Svg>
        ) : null}
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

      </View>

      {/*
        * The disc lives OUTSIDE the shadowed capsule, and that placement is the fix for a real
        * artefact rather than a tidy-up. `shellElevation` is an RN shadow on a view with no
        * backgroundColor, so iOS derives it from the layer's alpha — which is exactly what makes it
        * follow the holed capsule for free. While the disc was a child of that view it joined the
        * silhouette, and its shadow was cast INTO the hole: a grey crescent hugging the disc's lower
        * edge, sitting in the gap that is supposed to show the page. Out here the disc casts nothing
        * and the hole stays clean; the capsule's own rim still shades it, which is what makes the
        * cut read as a cut.
        */}
      {slotWidth > 0 && activeIcon ? (
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="absolute items-center justify-center rounded-full"
          style={{
            width: shell.notch,
            height: shell.notch,
            top: 0,
            left: shell.inset + discOffset(active, slotWidth, shell.notch),
          }}
        >
          <View
            className="items-center justify-center rounded-full bg-action"
            style={{ width: shell.disc, height: shell.disc }}
          >
            <Icon name={activeIcon} size={24} fill className="text-action-fg" />
            {activeBadge ? <SlotBadge label={activeBadge} onDisc /> : null}
          </View>
        </View>
      ) : null}
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
        tone={onDisc ? 'onHero' : 'onAction'}
        allowFontScaling={false}
        tabular
      >
        {label}
      </AppText>
    </View>
  );
}
