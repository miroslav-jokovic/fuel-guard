import { View } from 'react-native';
import { Map, Camera, Marker } from '@maplibre/maplibre-react-native';
import type { Load, LoadStop } from '@silvicom/shared';
import { stopProgress } from '@silvicom/shared';
import { AppText, Badge, Card, Icon, IconButton } from '@/components';
import { placeLabel } from './loadViewModel';
import { mapStyleUrl } from '@/lib/env';
import { useIsOnline } from '@/lib/connectivity';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Where the stop is, as a picture (D-DB7).
 *
 * `pointerEvents="none"` is deliberate: this is a map, not a navigator. The app has no route
 * service and no turn-by-turn (D-DB8 / Q-DB3), so a pannable map would promise something that does
 * not exist behind it. It orients the driver in a yard they have never been to; that is all.
 *
 * MapLibre fetches OpenFreeMap tiles live and there is no offline basemap, so with no signal — or a
 * stop dispatch geocoded without coordinates — the flat navy hero takes its place rather than a
 * grey rectangle that reads as a broken map.
 */
export function StopHero({
  load,
  stop,
  onBack,
}: {
  load: Load;
  stop: LoadStop;
  onBack: () => void;
}) {
  const online = useIsOnline();
  const { isDark } = useTheme();
  const progress = stopProgress(load);
  // Narrowed once so the coordinates carry their non-null type into the map, rather than four
  // assertions at the use sites.
  const at: [number, number] | null =
    stop.lon != null && stop.lat != null ? [stop.lon, stop.lat] : null;
  const canMap = online && at !== null;

  return (
    <View>
      {canMap && at ? (
        <View className="overflow-hidden rounded-xl" style={{ height: 260 }} pointerEvents="none">
          <Map style={{ flex: 1 }} mapStyle={mapStyleUrl(isDark)} logo={false} compass={false} attribution>
            <Camera center={at} zoom={13} duration={0} />
            <Marker lngLat={at}>
              <View className="h-8 w-8 items-center justify-center rounded-full bg-action/25">
                <View className="h-4 w-4 rounded-full border-2 border-surface bg-action" />
              </View>
            </Marker>
          </Map>
        </View>
      ) : (
        <View className="items-center justify-center gap-2 rounded-xl bg-hero px-5" style={{ height: 200 }}>
          <Icon name="pin_drop" size={40} className="text-action" />
          <AppText variant="supporting" tone="onHeroSecondary" className="text-center">
            {stop.address_line ?? placeLabel(stop)}
          </AppText>
          {!online ? (
            <AppText variant="caption" tone="onHeroMuted">Map returns when you have signal</AppText>
          ) : null}
        </View>
      )}

      <View className="absolute inset-x-0 top-0 flex-row items-start gap-2 p-3">
        <IconButton name="arrow_back" label="Back" variant="white" onPress={onBack} />
        <View className="flex-1">
          <Card>
            <AppText variant="supporting" className="font-ui-md" numberOfLines={1}>{stop.name}</AppText>
            <AppText variant="caption" tone="muted" numberOfLines={1}>
              Stop {progress.current} of {progress.total} · {stop.kind === 'pickup' ? 'Pick up' : 'Deliver'} · {load.ref}
            </AppText>
          </Card>
        </View>
        {stop.arrived_at ? <Badge label={`Arrived ${clock(stop.arrived_at)}`} tone="success" /> : null}
      </View>
    </View>
  );
}

function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
