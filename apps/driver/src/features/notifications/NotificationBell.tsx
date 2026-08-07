import { Pressable, Text, View } from 'react-native';
import { Icon } from '@/components';
import { haptics } from '@/lib/haptics';

/**
 * The Home top-bar bell (D51/Phase 6): a 44pt target with the unread count as a real number badge
 * — text + position, never color alone (DESIGN.md). Caps at 9+ so the badge never widens into the
 * avatar. Screen-reader label carries the count, since the badge itself is decorative to VoiceOver.
 */
export function NotificationBell({ unread, onPress }: { unread: number; onPress: () => void }) {
  const capped = unread > 9 ? '9+' : String(unread);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
      onPress={() => {
        haptics.select();
        onPress();
      }}
      className="h-11 w-11 items-center justify-center rounded-full active:bg-surface-subtle"
      hitSlop={4}
    >
      <Icon name={unread > 0 ? 'notifications_active' : 'notifications'} size={26} className="text-ink" />
      {unread > 0 ? (
        <View className="absolute right-0.5 top-0.5 min-w-[18px] items-center justify-center rounded-full bg-danger px-1 py-0.5">
          <Text
            className="text-[10px] font-sans-bold text-ink-inverse"
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {capped}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
