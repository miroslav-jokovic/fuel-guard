import { useContext, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { BottomTabBarHeightContext } from 'expo-router/js-tabs';
import { layout } from '@/theme/tokens';
import { shellHeight } from './tabBarModel';
import { HeroBackdrop } from './HeroBackdrop';
import type { HeroTextureName } from '@/theme/heroTexture';
import { heroTopPadding, screenBottomPadding, screenTopPadding } from '@/theme/safeArea';
import { useTheme } from '@/theme/ThemeProvider';
import { roleColors } from '@/theme/colors';
import { ui } from '@/theme/classes';

/**
 * Safe-area + canvas wrapper. Scrolls by default; `scroll={false}` gives a fixed flex column
 * (map/nav screens). `footer` renders OUTSIDE the scroll area, pinned above the home indicator —
 * task screens put their ActionBar here so the primary action is always reachable without
 * scrolling, instead of sitting below the fold at the end of the content.
 *
 * `hero` turns the screen into the Direction B two-layer composition (D-DB1): a navy region at the
 * top, and a light sheet with 28pt corners riding 28pt over it. There is ONE ScrollView — the hero
 * scrolls away with the content rather than pinning, because a driver reading a list should not be
 * paying for a header they have already read.
 *
 * Every Screen renders its own StatusBar. ThemeProvider used to own one globally, which cannot be
 * right once some screens are navy in the light theme and some are white: expo-status-bar honours
 * the most recently mounted one, so a tab switch from Today to Settings has to restore dark content.
 */
export function Screen({
  children,
  scroll = true,
  padTop = true,
  footer,
  hero,
  heroTexture = 'band',
  flow = 'flat',
  onRefresh,
  refreshing = false,
}: {
  children: ReactNode;
  scroll?: boolean;
  /** Adds the visual gutter above the content. The SAFE-AREA inset is applied either way. */
  padTop?: boolean;
  footer?: ReactNode;
  /**
   * Pull-to-refresh. Today runs five independent queries and had no gesture to re-ask any of them:
   * a driver whose data went stale in a dead zone could only kill the app and reopen it. Optional,
   * because a task screen with a single mutation has nothing to pull for.
   */
  onRefresh?: () => void;
  refreshing?: boolean;
  /** The navy hero region. Its presence, not a flag, is what makes this a hero screen. */
  hero?: ReactNode;
  /**
   * Which artwork backs the hero. `band` — the default — is capped for a hero that carries all three
   * `on-hero` tones. `auth` is the looser one, and is only honest on a hero that carries the mark
   * alone; see `src/theme/heroTexture.ts`.
   */
  heroTexture?: HeroTextureName;
  /**
   * `sections` means the children are `Section`s, which own the space above them, so the flow adds
   * none. `flat` keeps a uniform 16pt gap between loose children. A hero screen is always
   * `sections` — that composition has no loose children by construction.
   *
   * This is a per-screen choice rather than one global flip because the two rhythms cannot coexist:
   * a screen that has both would get 40pt between its sections. Each screen changes when its own
   * step recomposes it, and the call site says which rhythm it is on.
   */
  flow?: 'flat' | 'sections';
}) {
  const insets = useSafeAreaInsets();
  const { isDark } = useTheme();
  const { width } = useWindowDimensions();
  /**
   * Inside a tab the scene now passes UNDER the floating shell, so it has to end above it. The
   * context answers "am I in a tab"; the height comes from `shellHeight`, the same model the bar
   * draws itself from — see the note there for why this is not read from the context's value.
   */
  const protectedByTabBar = useContext(BottomTabBarHeightContext) !== undefined;
  const tabBarHeight = protectedByTabBar ? shellHeight(insets.bottom) : 0;
  const top = screenTopPadding(insets.top, padTop);

  /**
   * Android 16 ignores the portrait lock on displays this wide for apps targeting API 36 (§6 P1),
   * so a foldable or tablet WILL render this app in landscape whatever the manifest says. Content
   * is centred in a readable column rather than stretched into a 900pt line length.
   */
  const columnStyle = width >= 600 ? ({ maxWidth: 560, width: '100%', alignSelf: 'center' } as const) : undefined;

  const statusBar = <StatusBar style={hero || isDark ? 'light' : 'dark'} />;

  /**
   * A pinned footer has to clear the floating shell, not sit under it.
   *
   * This used to read `protectedByTabBar ? 0 : insets.bottom`, which was right while the shell was an
   * opaque band the scene ended above — the footer landed ON the band and adding the inset again put
   * 34pt of empty raised surface between the button and the bar. Now that the shell floats OVER the
   * scene, zero puts the Documents tab's capture bar directly underneath it: two bars stacked in the
   * same place, which is exactly what it looked like.
   */
  const footerNode = footer ? (
    <View style={[{ paddingHorizontal: layout.screenInset, paddingBottom: (protectedByTabBar ? tabBarHeight : insets.bottom) + 8 }, columnStyle]}>
      {footer}
    </View>
  ) : null;

  if (hero) {
    return (
      <KeyboardAvoidingView
        className="flex-1 bg-hero"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {statusBar}
        {/*
          * The bottom inset belongs INSIDE the sheet, not on the scroll container.
          *
          * It used to sit on `contentContainerStyle`, outside the `flex-1` sheet below — so on a
          * hero screen those 24pt rendered as a band of exposed navy between the white sheet and
          * the tab bar, and the tab bar's 28pt corners then cut two light notches into it. It read
          * as a rendering fault, and it was loudest on a nearly empty screen. Moving it inside lets
          * the sheet run to the bottom of the scene, which is what D-DB1's "one stacked surface"
          * asks for.
          */}
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                // The spinner belongs over the hero, not over the sheet that slides under it.
                tintColor={isDark ? roleColors.dark.onHeroSecondary : roleColors.light.onHeroSecondary}
              />
            ) : undefined
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* The backdrop is full-bleed and the hero content is inset, so they are two views:
              a padded child inside an unpadded wrapper the absolute backdrop can fill. On a wide
              screen the content still centres in its readable column while the art runs edge to
              edge, which is what a backdrop is for. */}
          <View>
            <HeroBackdrop texture={heroTexture} />
            <View
              style={[
                {
                  paddingTop: heroTopPadding(insets.top),
                  paddingHorizontal: layout.screenInset,
                  paddingBottom: layout.sheetOverlap + 20,
                },
                columnStyle,
              ]}
            >
              {hero}
            </View>
          </View>
          {/* A flat-flow sheet keeps the same 16pt gap between loose children as a flat screen;
              the auth screens (D-DB15) are the first hero screens that are not made of Sections. */}
          <View
            className={`flex-1 rounded-t-2xl bg-canvas ${flow === 'flat' ? 'gap-4' : ''}`}
            style={{
              marginTop: -layout.sheetOverlap,
              paddingTop: layout.sheetTopPadding,
              paddingHorizontal: layout.screenInset,
              paddingBottom: screenBottomPadding(insets.bottom, Boolean(footer), tabBarHeight),
            }}
          >
            {columnStyle ? <View style={columnStyle}>{children}</View> : children}
          </View>
        </ScrollView>
        {footerNode}
      </KeyboardAvoidingView>
    );
  }

  if (!scroll) {
    return (
      <KeyboardAvoidingView className={ui.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {statusBar}
        <View
          className={ui.fixedContent}
          style={[columnStyle, {
            paddingTop: top,
            // A fixed (non-scrolling) tab screen has no scroll padding to save it, so it takes the
            // shell's height directly or its last control sits under the capsule.
            paddingBottom: footer
              ? layout.screenInset
              : (protectedByTabBar ? tabBarHeight : insets.bottom) + layout.screenInset,
          }]}
        >
          {children}
        </View>
        {footerNode}
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView className={ui.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {statusBar}
      <ScrollView
        contentContainerClassName={flow === 'sections' ? ui.scrollContentSections : ui.scrollContent}
        contentContainerStyle={[{
          paddingTop: top,
          paddingBottom: screenBottomPadding(insets.bottom, Boolean(footer), tabBarHeight),
        }, columnStyle]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
      {footerNode}
    </KeyboardAvoidingView>
  );
}
