import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from './AppText';
import { SilvicomLogo360 } from './SilvicomLogo360';
import { layout } from '@/theme/tokens';

/**
 * Blocking update gate (hardening plan 4.6). Rendered INSTEAD of the navigator when this build's
 * version is below the org's `core.app` minVersion — the standard fleet-app force-upgrade screen.
 * Deliberately actionless beyond the instruction: the store is the only way forward, and a driver
 * mid-shift on a broken old build is worse than five minutes updating. The gate itself fails OPEN
 * (isVersionBelow) on any malformed config, so a typo in the dashboard can never brick a fleet.
 */
export function UpdateRequired({ minVersion }: { minVersion: string }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      className="flex-1 bg-canvas"
      contentContainerClassName="gap-4 px-4"
      contentContainerStyle={{
        paddingTop: insets.top + layout.regionGap,
        paddingBottom: insets.bottom + layout.sectionGap,
      }}
      showsVerticalScrollIndicator={false}
    >
      <SilvicomLogo360 />
      <View className="gap-2">
        <AppText variant="screenTitle">Update required</AppText>
        <AppText tone="secondary">
          Your fleet requires FuelGuard Driver {minVersion} or newer. Update from the app store, then
          reopen the app. Your queued work is safe and will sync as usual.
        </AppText>
      </View>
    </ScrollView>
  );
}
