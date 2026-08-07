import { Text, View } from 'react-native';
import { Icon } from './Icon';

/**
 * Blocking update gate (hardening plan 4.6). Rendered INSTEAD of the navigator when this build's
 * version is below the org's `core.app` minVersion — the standard fleet-app force-upgrade screen.
 * Deliberately actionless beyond the instruction: the store is the only way forward, and a driver
 * mid-shift on a broken old build is worse than five minutes updating. The gate itself fails OPEN
 * (isVersionBelow) on any malformed config, so a typo in the dashboard can never brick a fleet.
 */
export function UpdateRequired({ minVersion }: { minVersion: string }) {
  return (
    <View className="flex-1 items-center justify-center gap-4 bg-canvas px-8">
      <Icon name="download" size={48} className="text-brand" />
      <Text className="text-center text-2xl font-sans-bold text-ink">Update required</Text>
      <Text className="text-center text-base text-ink-secondary">
        Your fleet requires FuelGuard Driver {minVersion} or newer. Update from the app store, then
        reopen the app — your queued work is safe and will sync as usual.
      </Text>
    </View>
  );
}
