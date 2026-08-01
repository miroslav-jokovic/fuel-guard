import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useTheme } from '@/theme/ThemeProvider';
import { roleColors } from '@/theme/colors';
import homeIcon from '../../assets/tab-icons/home.png';
import homeIconSelected from '../../assets/tab-icons/home-selected.png';
import loadsIcon from '../../assets/tab-icons/loads.png';
import loadsIconSelected from '../../assets/tab-icons/loads-selected.png';
import navigateIcon from '../../assets/tab-icons/navigate.png';
import navigateIconSelected from '../../assets/tab-icons/navigate-selected.png';
import scoreIcon from '../../assets/tab-icons/score.png';
import scoreIconSelected from '../../assets/tab-icons/score-selected.png';
import moreIcon from '../../assets/tab-icons/more.png';
import moreIconSelected from '../../assets/tab-icons/more-selected.png';

/**
 * Native navigation shell (D51). Five task-oriented tabs — Home · Loads · Navigate · Score · More.
 *
 * React Navigation's native tab implementation is used through Expo Router's NativeTabs wrapper.
 * This delegates safe-area geometry, platform alignment, selected states, scroll-to-top behavior,
 * and iOS/Android native tab rendering to the platform instead of maintaining a custom tab bar.
 * Labels remain accessible but are visually hidden for the compact driver shell.
 */
export default function TabsLayout() {
  const { isDark } = useTheme();
  const rc = isDark ? roleColors.dark : roleColors.light;

  return (
    <NativeTabs
      tintColor={rc.brand}
      iconColor={{ default: rc.inkSecondary, selected: rc.brand }}
      backgroundColor={rc.surface}
      labelVisibilityMode="unlabeled"
      tabBarRespectsIMEInsets
      disableTransparentOnScrollEdge
    >
      <NativeTabs.Trigger name="home" accessibilityLabel="Home">
        <NativeTabs.Trigger.Label hidden>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={{ default: homeIcon, selected: homeIconSelected }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="loads" accessibilityLabel="Loads">
        <NativeTabs.Trigger.Label hidden>Loads</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={{ default: loadsIcon, selected: loadsIconSelected }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="navigate" accessibilityLabel="Navigate">
        <NativeTabs.Trigger.Label hidden>Navigate</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={{ default: navigateIcon, selected: navigateIconSelected }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="score" accessibilityLabel="Score">
        <NativeTabs.Trigger.Label hidden>Score</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={{ default: scoreIcon, selected: scoreIconSelected }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="more" accessibilityLabel="More">
        <NativeTabs.Trigger.Label hidden>More</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={{ default: moreIcon, selected: moreIconSelected }} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
