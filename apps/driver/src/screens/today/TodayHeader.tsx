import { View } from 'react-native';
import { AppText } from '@/components';
import { MessagesButton } from '@/features/messages/MessagesButton';
import { NotificationBell } from '@/features/notifications/NotificationBell';

/**
 * Today's title, in the carrier's display face (D-DV18: tab titles stay in the content, in Big
 * Shoulders, not in a native large-title header), with the two inboxes beside it.
 *
 * It replaces Direction B's duty strip, which greeted the driver by name over an avatar. A greeting
 * is on D-DV14's banned list, and the duty facts it carried now live where they are used: "Off duty ·
 * Unit 2241" in the status block before the shift, and the rig row once it has started.
 */
export function TodayHeader({
  messages,
  notifications,
}: {
  messages?: { unread: number; onPress: () => void };
  notifications?: { unread: number; onPress: () => void };
}) {
  return (
    <View className="flex-row items-center gap-1" style={{ minHeight: 48 }}>
      <AppText variant="screenTitle" accessibilityRole="header" className="flex-1">Today</AppText>
      {messages ? <MessagesButton unread={messages.unread} onPress={messages.onPress} /> : null}
      {notifications ? <NotificationBell unread={notifications.unread} onPress={notifications.onPress} /> : null}
    </View>
  );
}
