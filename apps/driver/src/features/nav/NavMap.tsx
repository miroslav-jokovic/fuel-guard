import { View } from 'react-native';
import { Map, Camera, GeoJSONSource, Layer, Marker } from '@maplibre/maplibre-react-native';
import type { Feature, LineString } from 'geojson';
import { useTheme } from '@/theme/ThemeProvider';
import { roleColors } from '@/theme/colors';
import { mapStyleUrl } from '@/lib/env';

/**
 * NP0 map spike (NAVIGATION-PROGRAMME-PLAN §NP0). Proves MapLibre renders on this Expo SDK 57 /
 * RN 0.86 / new-arch stack with a free, no-account vector basemap (env.mapStyleUrl — swappable per
 * NAV N4) and draws a hardcoded HERE-style route polyline + origin/destination markers, theme-aware.
 * NP1 replaces the hardcoded route with the live server route for the driver's accepted load.
 * MapLibre needs no access token (open tiles). Fixed height so it sits inside the scrolling Screen;
 * NP2/NP3 promote it to a full-screen, follow-mode map.
 */
const ROUTE: Feature<LineString> = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'LineString',
    coordinates: [
      [-88.0817, 41.525], // Joliet, IL
      [-87.3, 41.45],
      [-86.5, 41.2],
      [-85.6, 40.9],
      [-84.6, 40.4],
      [-83.7, 40.1],
      [-83.0004, 39.9612], // Columbus, OH
    ],
  },
};
const COORDS = ROUTE.geometry.coordinates;
const START = COORDS[0] as [number, number];
const END = COORDS[COORDS.length - 1] as [number, number];
const CENTER: [number, number] = [(START[0] + END[0]) / 2, (START[1] + END[1]) / 2];

export function NavMap() {
  const { isDark } = useTheme();
  const rc = roleColors[isDark ? 'dark' : 'light'];

  return (
    <View className="overflow-hidden rounded-xl border border-edge" style={{ height: 280 }}>
      <Map
        style={{ flex: 1 }}
        mapStyle={mapStyleUrl(isDark)}
        logo={false}
        compass={false}
        attribution
      >
        <Camera center={CENTER} zoom={4.6} duration={0} />
        <GeoJSONSource id="route" data={ROUTE}>
          <Layer
            id="route-line"
            type="line"
            paint={{ 'line-color': rc.brand, 'line-width': 5 }}
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          />
        </GeoJSONSource>
        <Marker lngLat={START}>
          <View className="h-4 w-4 rounded-full border-2 border-brand bg-surface" />
        </Marker>
        <Marker lngLat={END}>
          <View className="h-4 w-4 rounded-full border-2 border-surface bg-brand" />
        </Marker>
      </Map>
    </View>
  );
}
