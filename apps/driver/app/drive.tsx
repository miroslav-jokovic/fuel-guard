import { Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Badge, Banner, ListRow, Screen, ScreenHeader, SectionLabel } from '@/components';
import { NavMap } from '@/features/nav/NavMap';

// Navigation modal (Phase 4 shell): opened by the elevated center tab / the load's Navigate CTA.
// Shows the planned route + fuel stops as an honest schematic preview; Phase 4 swaps the preview
// panel for the live MapLibre view over the server's HERE route (plan §8/§15) and makes the fuel
// stops live plan data.
export default function Drive() {
  const router = useRouter();
  return (
    <Screen>
      <ScreenHeader
        title="Navigate"
        subtitle="LD-20481 · Joliet, IL → Columbus, OH"
        onClose={() => router.back()}
      />

      <NavMap />

      <SectionLabel>Planned fuel stops</SectionLabel>
      <ListRow
        icon="local_gas_station"
        title="Pilot Travel Center"
        subtitle="Effingham, IL · $3.42/gal · buy 62 gal"
        right={<Badge label="in 118 mi" tone="brand" />}
      />
      <ListRow
        icon="local_gas_station"
        title="Love's Travel Stop"
        subtitle="Greenfield, IN · $3.51/gal · buy 40 gal"
        right={<Badge label="in 289 mi" tone="neutral" />}
      />

      <Banner
        tone="info"
        icon="navigation"
        message="Early map preview on free basemap tiles, showing a sample route. The live truck-safe route for your accepted load lands next (NP1)."
      />

      <Text className="pt-1 text-center text-xs text-ink-subtle">
        Sample data — the fueling plan comes from your fleet's smart-fueling engine.
      </Text>
    </Screen>
  );
}
