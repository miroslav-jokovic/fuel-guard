import { Pressable } from 'react-native';
import { CountBadge, Icon } from '@/components';
import { haptics } from '@/lib/haptics';

/** Home top-bar messages entry (D51/Phase 7) — the bell's sibling: 44pt target, numeric unread
 *  badge capped at 9+, count carried in the screen-reader label. */
export function MessagesButton({ unread, onPress, onHero = false }: { unread: number; onPress: () => void; onHero?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={unread > 0 ? `Messages, ${unread} unread` : 'Messages'}
      onPress={() => {
        haptics.select();
        onPress();
      }}
      className={`h-11 w-11 items-center justify-center rounded-full ${onHero ? 'bg-on-hero/10 active:bg-on-hero/20' : 'active:bg-surface-subtle'}`}
      hitSlop={4}
    >
      <Icon name="mail" size={22} fill={unread > 0} className={onHero ? 'text-on-hero' : 'text-ink'} />
      <CountBadge count={unread} />
    </Pressable>
  );
}
