import { Text, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { Icon } from './Icon';
import { useIsOnline } from '@/lib/connectivity';
import { useSyncState } from '@/data/sync';

/**
 * Honest connectivity state (plan §13.4). Offline is NORMAL in a truck, not an error — the copy
 * reassures ("saved, will sync") instead of alarming. Renders nothing when online with nothing
 * queued, so the UI stays quiet in the common case.
 */
export function OfflineBanner() {
  const online = useIsOnline();
  const { pending } = useSyncState();

  if (online && pending === 0) return null;

  const offline = !online;
  const message = offline
    ? pending > 0
      ? `Offline — ${pending} ${pending === 1 ? 'item is' : 'items are'} saved and will sync`
      : 'Offline — your work is saved and will sync'
    : `Syncing ${pending} ${pending === 1 ? 'item' : 'items'}…`;

  return (
    <Animated.View
      entering={FadeInUp.duration(180)}
      exiting={FadeOutUp.duration(160)}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      className={`flex-row items-center gap-2.5 rounded-xl px-3.5 py-2.5 ${
        offline ? 'bg-warning/10' : 'bg-info/10'
      }`}
    >
      <Icon
        name={offline ? 'cloud_off' : 'cloud_sync'}
        size={18}
        className={offline ? 'text-warning' : 'text-info'}
      />
      <Text className="flex-1 text-sm text-ink-secondary">{message}</Text>
      {!offline && pending > 0 ? (
        <View className="h-1.5 w-1.5 rounded-full bg-info" />
      ) : null}
    </Animated.View>
  );
}
