import { Pressable, View } from 'react-native';
import { AppText, Icon } from '@/components';
import { haptics } from '@/lib/haptics';

/** Home top-bar messages entry (D51/Phase 7) — the bell's sibling: 44pt target, numeric unread
 *  badge capped at 9+, count carried in the screen-reader label. */
export function MessagesButton({ unread, onPress }: { unread: number; onPress: () => void }) {
  const capped = unread > 9 ? '9+' : String(unread);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={unread > 0 ? `Messages, ${unread} unread` : 'Messages'}
      onPress={() => {
        haptics.select();
        onPress();
      }}
      className="h-11 w-11 items-center justify-center rounded-full active:bg-surface-subtle"
      hitSlop={4}
    >
      <Icon name="mail" size={26} fill={unread > 0} className="text-ink" />
      {unread > 0 ? (
        <View className="absolute right-0.5 top-0.5 min-w-[18px] items-center justify-center rounded-full bg-danger px-1 py-1">
          <AppText variant="caption" tone="inverse" allowFontScaling={false} className="text-micro font-bold" tabular>
            {capped}
          </AppText>
        </View>
      ) : null}
    </Pressable>
  );
}
