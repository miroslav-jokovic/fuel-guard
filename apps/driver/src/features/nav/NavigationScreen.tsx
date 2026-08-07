import { AppText, Badge, Banner, GroupedList, ListRow, Screen, ScreenHeader, SectionLabel } from '@/components';
import { NavMap } from './NavMap';

/**
 * Navigation surface shared by the Navigate tab and the standalone navigation route. The tab keeps
 * the bottom bar visible; the standalone route is presented as a modal over the shell.
 */
export function NavigationScreen({ onClose }: { onClose: () => void }) {
  return (
    <Screen>
      <ScreenHeader
        title="Navigate"
        subtitle="LD-20481 · Joliet, IL → Columbus, OH"
        onClose={onClose}
      />

      <NavMap />

      <SectionLabel>Planned fuel stops</SectionLabel>
      <GroupedList>
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
      </GroupedList>

      <Banner
        tone="info"
        icon="navigation"
        message="Early map preview on free basemap tiles, showing a sample route. The live truck-safe route for your accepted load lands next (NP1)."
      />

      <AppText variant="caption" tone="subtle" className="pt-1 text-center">
        Sample data — the fueling plan comes from your fleet&apos;s smart-fueling engine.
      </AppText>
    </Screen>
  );
}
