import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Card, EmptyState, Icon, Screen, ScreenHeader } from '@/components';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

function PreviewRow({ icon, text }: { icon: MaterialSymbolName; text: string }) {
  return (
    <View className="flex-row items-center gap-2.5 py-1.5">
      <Icon name={icon} size={18} className="text-brand" />
      <Text className="flex-1 text-sm text-ink-secondary">{text}</Text>
    </View>
  );
}

// Navigation modal (Phase 4 shell): opened by the elevated center tab / the load's Navigate CTA.
// The map + corridor guidance + planned-fueling overlays land here (MapLibre over the server's
// HERE route — plan §8/§15).
export default function Drive() {
  const router = useRouter();
  return (
    <Screen padTop={false}>
      <ScreenHeader title="Navigate" subtitle="LD-20481 · Joliet → Columbus" onClose={() => router.back()} />

      <EmptyState
        icon="navigation"
        title="Navigation arrives with Phase 4"
        subtitle="Your truck-safe route renders here, with corridor guidance and your planned fuel stops."
      />

      <Card>
        <Text className="pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
          What this screen will do
        </Text>
        <PreviewRow icon="route" text="Truck-safe route for the active load (axle, weight, hazmat, tunnels)" />
        <PreviewRow icon="local_gas_station" text="Planned fuel stops — station, price, and gallons to buy" />
        <PreviewRow icon="pin_drop" text="Arrival hand-off into the stop's photo checklist" />
        <PreviewRow icon="wifi_off" text="Route cached for the corridor — works with no signal" />
      </Card>
    </Screen>
  );
}
