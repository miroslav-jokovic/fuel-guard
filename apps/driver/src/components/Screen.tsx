import { useContext, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { BottomTabBarHeightContext } from 'expo-router/js-tabs';
import { layout } from '@/theme/tokens';
import { heroTopPadding, screenBottomPadding, screenTopPadding } from '@/theme/safeArea';
import { useTheme } from '@/theme/ThemeProvider';
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
  flow = 'flat',
}: {
  children: ReactNode;
  scroll?: boolean;
  /** Adds the visual gutter above the content. The SAFE-AREA inset is applied either way. */
  padTop?: boolean;
  footer?: ReactNode;
  /** The navy hero region. Its presence, not a flag, is what makes this a hero screen. */
  hero?: ReactNode;
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
  const protectedByTabBar = useContext(BottomTabBarHeightContext) !== undefined;
  const top = screenTopPadding(insets.top, padTop);

  /**
   * Android 16 ignores the portrait lock on displays this wide for apps targeting API 36 (§6 P1),
   * so a foldable or tablet WILL render this app in landscape whatever the manifest says. Content
   * is centred in a readable column rather than stretched into a 900pt line length.
   */
  const columnStyle = width >= 600 ? ({ maxWidth: 560, width: '100%', alignSelf: 'center' } as const) : undefined;

  const statusBar = <StatusBar style={hero || isDark ? 'light' : 'dark'} />;

  const footerNode = footer ? (
    <View style={[{ paddingHorizontal: layout.screenInset, paddingBottom: insets.bottom + 8 }, columnStyle]}>
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
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            paddingBottom: screenBottomPadding(insets.bottom, Boolean(footer), protectedByTabBar),
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
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
          <View
            className="flex-1 rounded-t-2xl bg-canvas"
            style={{
              marginTop: -layout.sheetOverlap,
              paddingTop: layout.sheetTopPadding,
              paddingHorizontal: layout.screenInset,
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
            paddingBottom: footer
              ? layout.screenInset
              : (protectedByTabBar ? 0 : insets.bottom) + layout.screenInset,
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
          paddingBottom: screenBottomPadding(insets.bottom, Boolean(footer), protectedByTabBar),
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
