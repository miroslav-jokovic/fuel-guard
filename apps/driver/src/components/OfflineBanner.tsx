import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { useIsOnline } from '@/lib/connectivity';
import { useSyncState } from '@/data/sync';
import { useTheme } from '@/theme/ThemeProvider';

/** Compact connectivity strip. Current work remains visually dominant while offline. */
export function OfflineBanner() {
  const online = useIsOnline();
  const { pending } = useSyncState();
  const { reduceMotion } = useTheme();

  if (online && pending === 0) return null;

  const offline = !online;
  const message = offline
    ? pending > 0
      ? `Offline · ${pending} ${pending === 1 ? 'item is' : 'items are'} saved locally`
      : 'Offline · current work remains available'
    : `Syncing ${pending} ${pending === 1 ? 'item' : 'items'}`;

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeInUp.duration(140)}
      exiting={reduceMotion ? undefined : FadeOutUp.duration(120)}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      className={`min-h-11 flex-row items-center gap-2.5 rounded-lg border border-edge-subtle px-3 py-2 ${
        offline ? 'bg-warning/10' : 'bg-info/10'
      }`}
    >
      <Icon
        name={offline ? 'cloud_off' : 'cloud_sync'}
        size={18}
        className={offline ? 'text-sync-pending' : 'text-sync-local'}
      />
      <AppText variant="supporting" tone="secondary" className="flex-1">{message}</AppText>
    </Animated.View>
  );
}
