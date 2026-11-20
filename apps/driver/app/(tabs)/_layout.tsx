import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useFeatures } from '@/session/useFeatures';
import { useTheme } from '@/theme/ThemeProvider';
import { roleColors } from '@/theme/colors';
import { TABS } from '@/components/nativeTabsModel';
import { useLoads } from '@/features/loads/useLoads';
import { documentsView } from '@/features/documents/documentsModel';

/**
 * The tab shell is the operating system's own (Visual 2026 D-DV1, step V3).
 *
 * On iOS 26 `NativeTabs` is a real `UITabBarController`, so the bar is Apple's floating Liquid Glass
 * capsule. It adapts its glass to what scrolls under it, minimises on scroll the way the system apps
 * do, and gets every future iOS revision without a change here. On Android it is the Material 3
 * navigation bar. Direction B's custom `TabBar`, a JS capsule with a raised amber disc (D-DB11), and
 * its geometry model are deleted. That shell had been redrawn four times, and it could only ever
 * imitate the system.
 *
 * Still the owner's rulings:
 * - The tab set is Home · Loads · Documents · More (D-DB14).
 * - Loads (`tab.loads`) and Documents (`hazmat.capture`) are fleet-controllable. A disabled tab is
 *   not rendered at all, which is the Samsara rule: a feature the org turned off simply does not
 *   appear. Home and More are never conditional.
 * - There is no tab-switch motion (D-DB11 amendment). The system tab bar has none.
 *
 * Score and Navigate were hidden JS tabs reached by URL. A hidden NATIVE tab cannot be navigated to
 * at all, so both moved to the root stack (`app/score.tsx`, `app/navigate.tsx`) and keep their URLs.
 * Messages and Notifications remain Home's top-bar icons and rows in More (D51).
 *
 * The selected tab takes the live cyan (D-DV5), read from the role for the theme the app is actually
 * in. The app's own Theme setting can differ from the phone's, so `DynamicColorIOS` would be wrong.
 * Icons are SF Symbols on iOS and Material Symbols on Android (D-DV11), listed in `nativeTabsModel.ts`.
 */
export default function TabsLayout() {
  const { enabled } = useFeatures();
  const { themeKey } = useTheme();
  const colors = roleColors[themeKey];
  const visible = TABS.filter((tab) => !tab.feature || enabled(tab.feature));
  // The Documents badge is the status block's own count (V7), from the same model and the same cached
  // loads payload, so the tab and the screen can never disagree. Red, as the approved mock draws it:
  // the system writes the count in white, which amber could not carry.
  const loads = useLoads(enabled('tab.loads'));
  const owed = documentsView(loads.data?.loads ?? []).actionable;
  const badges: Partial<Record<(typeof TABS)[number]['name'], string>> = owed > 0 ? { documents: owed > 9 ? '9+' : String(owed) } : {};

  return (
    <NativeTabs
      tintColor={colors.accentInk}
      iconColor={colors.inkSecondary}
      labelStyle={{ color: colors.inkSecondary }}
      badgeBackgroundColor={colors.danger}
      minimizeBehavior="onScrollDown"
      // Android: the Material 3 bar on the app's own surface, its selection pill a raised step.
      backgroundColor={colors.surface}
      indicatorColor={colors.surfaceMuted}
      labelVisibilityMode="labeled"
    >
      {visible.map((tab) => (
        <NativeTabs.Trigger key={tab.name} name={tab.name}>
          <NativeTabs.Trigger.Label>{tab.label}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={tab.sf} md={tab.md} />
          {badges[tab.name] ? <NativeTabs.Trigger.Badge>{badges[tab.name]}</NativeTabs.Trigger.Badge> : null}
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}
