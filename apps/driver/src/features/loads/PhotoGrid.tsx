import { Image, Pressable, View } from 'react-native';
import { photoSlotLabel, type LoadStop } from '@silvicom/shared';
import { ActivityIndicator } from 'react-native';
import { AppText, Badge, Icon } from '@/components';
import { photoTileState } from './itineraryModel';
import type { SessionCapture } from './stopCaptureModel';
import { roleColors } from '@/theme/colors';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * The stop's required photos as two columns of tiles.
 *
 * Each tile is the slot, not a row about the slot: a driver in a yard is matching what they see
 * through the windscreen to what the app is asking for, and a 14pt thumbnail beside a label does
 * not support that. An uncaptured tile carries the dashed amber outline — the one card-inside-a-card
 * DESIGN.md allows, because a document preview IS a nested object.
 *
 * A tile never claims more than the app knows: `Captured HH:MM` only for an image taken this
 * session and still on the phone, `Already added` for a slot the server has satisfied where the
 * image is not local. `SessionCapture` carries `localUri` and `capturedAt` and nothing else — page
 * counts and sharpness belong to the hazmat capture engine, not to a stop photo.
 */
export function PhotoGrid({
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
    <View className="flex-row flex-wrap gap-3">
      {stop.required_photos.map((slot) => {
        const state = photoTileState(slot, stop, captures);
        const shot = captures.find((c) => c.slot === slot) ?? null;
        const busy = busySlot === slot;
        return (
          <Pressable
            key={slot}
            accessibilityRole="button"
            accessibilityLabel={`${photoSlotLabel(slot)}, ${LABEL[state]}`}
            disabled={busy}
            onPress={() => onCapture(slot)}
            className="min-w-40 flex-1 gap-2 rounded-xl bg-surface p-2 active:bg-surface-selected"
          >
            <View
              className={`items-center justify-center overflow-hidden rounded-lg ${
                state === 'required' ? 'border-2 border-dashed border-action bg-action-soft' : 'bg-surface-muted'
              }`}
              style={{ height: 120 }}
            >
              {busy ? (
                <ActivityIndicator color={roleColors[themeKey].actionInk} />
              ) : shot ? (
                <Image source={{ uri: shot.localUri }} style={{ width: '100%', height: '100%' }} />
              ) : (
                <Icon
                  name={state === 'already' ? 'check_circle' : 'photo_camera'}
                  size={30}
                  fill={state === 'already'}
                  className={state === 'already' ? 'text-success' : 'text-action-ink'}
                />
              )}
              {shot ? (
                <View className="absolute right-2 top-2">
                  <Badge label="Saved" tone="success" />
                </View>
              ) : null}
            </View>
            <View className="gap-0.5 px-1 pb-1">
              <AppText variant="rowTitle" numberOfLines={1}>{photoSlotLabel(slot)}</AppText>
              <AppText
                variant="caption"
                tone={state === 'required' ? 'action' : 'muted'}
                numberOfLines={1}
              >
                {shot ? `Captured ${clock(shot.capturedAt)}` : LABEL[state]}
              </AppText>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const LABEL: Record<'captured' | 'already' | 'required', string> = {
  captured: 'Captured',
  already: 'Already added',
  required: 'Required',
};

function clock(at: string | number): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
