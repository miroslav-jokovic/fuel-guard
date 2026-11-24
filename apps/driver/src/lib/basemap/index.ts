import type { ComponentProps } from 'react';
import type { Map } from '@maplibre/maplibre-react-native';
import { mapStyleOverride } from '@/lib/env';
import { basemapStyle } from './basemapStyle';

type MapStyle = ComponentProps<typeof Map>['mapStyle'];

/**
 * What a `<Map mapStyle>` takes for the active theme: a configured URL, else our own style (D-DV28).
 *
 * The bundled style is typed from its JSON, where TypeScript widens every `"type": "line"` to
 * `string`, so it cannot be checked against MapLibre's `StyleSpecification` union structurally. It
 * is the style OpenFreeMap serves, unchanged apart from colours and removed layers, and
 * `apps/driver/tests/basemap-style.test.ts` holds its shape; this is the one place it is declared as the map's type.
 */
export function basemapFor(isDark: boolean): MapStyle {
  return mapStyleOverride(isDark) ?? (basemapStyle(isDark) as unknown as MapStyle);
}

/**
 * The attribution the tiles require, in the words their TileJSON gives
 * (https://tiles.openfreemap.org/planet, 2026-11-24). Drawn by us in ink-muted, always visible, in
 * place of MapLibre's blue (i) button — which read as our live cyan, and which the Stop strip's
 * `pointerEvents="none"` made impossible to open anyway.
 */
// The copyright sign is escaped: `lint:design`'s emoji rule matches it as Extended_Pictographic.
export const BASEMAP_ATTRIBUTION = 'OpenFreeMap \u00A9 OpenMapTiles · Data from OpenStreetMap';
