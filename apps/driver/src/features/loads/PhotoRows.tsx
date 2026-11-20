import { ActivityIndicator, Image, View } from 'react-native';
import { photoSlotLabel, type LoadStop } from '@silvicom/shared';
import { AppText, GroupedList, ListRow } from '@/components';
import { photoRows } from './itineraryModel';
import type { SessionCapture } from './stopCaptureModel';
import { roleColors } from '@/theme/colors';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * The stop's photos as rows (Visual 2026 V6, mock screen 6): a missing photo first, with its glyph and
 * the word "Take" in amber (D-DV5: act); a taken one in green with "Retake". Tapping either opens the
 * camera for that slot. A photo taken in this session shows its thumbnail beside the word, so the
 * driver can check it is the right paper. What each row says is `photoRows`, which is tested.
 *
 * It replaces Direction B's grid of 120pt tiles with dashed amber outlines, a card inside a card.
 */
export function PhotoRows({
  stop,
  captures,
  busySlot,
  onCapture,
}: {
  stop: LoadStop;
  captures: readonly SessionCapture[];
  busySlot: string | null;
  onCapture: (slot: string) => void;
}) {
  const { themeKey } = useTheme();
  return (
    <GroupedList>
      {photoRows(stop, captures).map((row) => {
        const shot = captures.find((c) => c.slot === row.slot) ?? null;
        return (
          <ListRow
            key={row.slot}
            icon={row.state === 'required' ? 'photo_camera' : 'check_circle'}
            disc={row.state === 'required' ? 'caution' : 'success'}
            title={photoSlotLabel(row.slot)}
            subtitle={row.detail}
            disabled={busySlot !== null && busySlot !== row.slot}
            onPress={() => onCapture(row.slot)}
            right={
              busySlot === row.slot ? (
                <ActivityIndicator color={roleColors[themeKey].actionInk} />
              ) : (
                <View className="flex-row items-center gap-3">
                  {shot ? (
                    <Image
                      source={{ uri: shot.localUri }}
                      accessibilityIgnoresInvertColors
                      className="h-10 w-10 rounded-md"
                    />
                  ) : null}
                  <AppText variant="supporting" weight="semibold" tone={row.action.tone === 'act' ? 'action' : 'secondary'}>
                    {row.action.text}
                  </AppText>
                </View>
              )
            }
          />
        );
      })}
    </GroupedList>
  );
}
