import { Pressable } from 'react-native';
import { CountBadge, Icon } from '@/components';
import { haptics } from '@/lib/haptics';

/**
 * The Home top-bar bell (D51/Phase 6): a 44pt target with the unread count as a real number badge
 * — text + position, never color alone (DESIGN.md). Caps at 9+ so the badge never widens into the
 * avatar. Screen-reader label carries the count, since the badge itself is decorative to VoiceOver.
 */
export function NotificationBell({ unread, onPress, onHero = false }: { unread: number; onPress: () => void; onHero?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
      onPress={() => {
        haptics.select();
        onPress();
      }}
      className={`h-11 w-11 items-center justify-center rounded-full ${onHero ? 'bg-on-hero/10 active:bg-on-hero/20' : 'active:bg-surface-subtle'}`}
      hitSlop={4}
    >
      <Icon name={unread > 0 ? 'notifications_active' : 'notifications'} size={22} className={onHero ? 'text-on-hero' : 'text-ink'} />
      <CountBadge count={unread} />
    </Pressable>
  );
}
