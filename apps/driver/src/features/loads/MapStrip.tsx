import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Map, Camera, Marker } from '@maplibre/maplibre-react-native';
import type { LoadStop } from '@silvicom/shared';
import { AppText, Icon, IconButton } from '@/components';
import { placeLabel } from './loadViewModel';
import { mapStyleUrl } from '@/lib/env';
import { useIsOnline } from '@/lib/connectivity';
import { useTheme } from '@/theme/ThemeProvider';

/** The strip's fixed height (mock screen 6): enough to orient in a yard, never the whole screen. */
const HEIGHT = 250;

/**
 * Where the stop is, as a full-bleed strip at a fixed height (Visual 2026 V6, Strava's route strip;
 * DESIGN.md "Map strip"). It is a picture, not a navigator: `pointerEvents="none"`, because the app has
 * no routing service (D-DB8 / D-DV13) and a pannable map would promise one. Navigate, in the screen's
 * footer, hands the trip to the phone's own maps app instead.
 *
 * The back button floats over the map in Liquid Glass on iOS 26 (V9; D-DV2's one place we add our own
 * glass), and on the solid white disc everywhere else, the fallback the decision names. The glyph on
 * the glass follows what is under it: the role theme's ink over the map (whose style follows the same
 * theme), the on-hero ink over the navy field, where ink would be navy on navy in the light theme.
 *
 * MapLibre fetches tiles live and there is no offline basemap, so with no signal, or a stop dispatch
 * did not geocode, the navy field with the address takes the strip's place rather than a grey box that
 * reads as a broken map.
 */
export function MapStrip({ stop, onBack }: { stop: LoadStop; onBack: () => void }) {
  const online = useIsOnline();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const at: [number, number] | null = stop.lon != null && stop.lat != null ? [stop.lon, stop.lat] : null;
  const showMap = online && at !== null;

  return (
    <View style={{ height: HEIGHT + insets.top }}>
      {showMap && at ? (
        <View className="flex-1" pointerEvents="none">
          <Map style={{ flex: 1 }} mapStyle={mapStyleUrl(isDark)} logo={false} compass={false} attribution>
            <Camera center={at} zoom={13} duration={0} />
            <Marker lngLat={at}>
              <View className="h-8 w-8 items-center justify-center rounded-full bg-accent/25">
                <View className="h-4 w-4 rounded-full border-2 border-canvas bg-accent" />
              </View>
            </Marker>
          </Map>
        </View>
      ) : (
        <View className="flex-1 items-center justify-center gap-2 bg-hero px-5" style={{ paddingTop: insets.top }}>
          {/* The navy field is dark in both themes, so the clock over it is light (the last StatusBar
              mounted wins, which is why Screen's own one does not need to know). */}
          <StatusBar style="light" />
          <Icon name="place" size={36} className="text-on-hero-live" />
          <AppText variant="supporting" tone="onHeroSecondary" className="text-center">
            {stop.address_line ?? placeLabel(stop)}
          </AppText>
          {!online ? <AppText variant="caption" tone="onHeroMuted">Map returns when you have signal</AppText> : null}
        </View>
      )}
      <View className="absolute left-4" style={{ top: insets.top + 8 }}>
        {isLiquidGlassAvailable() ? (
          <GlassView isInteractive glassEffectStyle="regular" style={{ borderRadius: 22 }}>
            <IconButton name="arrow_back" label="Back" variant={showMap ? 'plain' : 'glass'} onPress={onBack} />
          </GlassView>
        ) : (
          <IconButton name="arrow_back" label="Back" variant="white" onPress={onBack} />
        )}
      </View>
    </View>
  );
}
