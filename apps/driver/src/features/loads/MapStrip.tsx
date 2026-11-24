import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Map, Camera, Marker } from '@maplibre/maplibre-react-native';
import type { LoadStop } from '@silvicom/shared';
import { AppText, Icon, IconButton } from '@/components';
import { placeLabel } from './loadViewModel';
import { BASEMAP_ATTRIBUTION, basemapFor } from '@/lib/basemap';
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
 * The back button floats over the map in Liquid Glass on iOS 26 over the dark map (V9; D-DV2's one
 * place we add our own glass), and on the solid white disc everywhere else, the fallback the decision
 * names; over the light map the glass did not separate from the roads. The glyph on
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
          <Map style={{ flex: 1 }} mapStyle={basemapFor(isDark)} logo={false} compass={false} attribution={false}>
            <Camera center={at} zoom={13} duration={0} />
            {/* The stop, as a pin in ink (D-DV28). It was a cyan dot, and cyan is "live" (D-DV5): the
                strip shows where the stop is, not a truck moving towards it. */}
            <Marker lngLat={at} anchor="bottom">
              <Icon name="place" size={40} className="text-ink" />
            </Marker>
          </Map>
          <View className="absolute bottom-1 right-2">
            <AppText variant="caption" tone="muted">{BASEMAP_ATTRIBUTION}</AppText>
          </View>
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
        {/* Glass over the DARK map only. Over the light map the glass disc measured ~1.2:1 against the
            roads, under WCAG 1.4.11's 3:1 for a control, so daylight keeps the solid white disc,
            D-DV2's named fallback (V9 critique). */}
        {isLiquidGlassAvailable() && (isDark || !showMap) ? (
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
