import { Text, View } from 'react-native';
import { Badge, Card, Icon, type Tone } from '@/components';

export type LoadStatus = 'upcoming' | 'in_transit' | 'delivered' | 'canceled';

export interface LoadSummary {
  id: string;
  ref: string;
  status: LoadStatus;
  origin: string;
  originTime: string;
  destination: string;
  destTime: string;
  stops: number;
  miles: string;
  equipment: string;
  hazmat?: boolean;
}

export const LOAD_STATUS: Record<LoadStatus, { label: string; tone: Tone }> = {
  upcoming: { label: 'Upcoming', tone: 'info' },
  in_transit: { label: 'In transit', tone: 'brand' },
  delivered: { label: 'Delivered', tone: 'success' },
  canceled: { label: 'Canceled', tone: 'neutral' },
};

/** The origin→destination timeline rail — the visual signature of every load surface. */
export function RouteRail({
  origin,
  originTime,
  destination,
  destTime,
}: {
  origin: string;
  originTime: string;
  destination: string;
  destTime: string;
}) {
  return (
    <View className="flex-row gap-3">
      <View className="w-4 items-center pt-1.5 pb-1">
        <View className="h-2.5 w-2.5 rounded-full border-2 border-brand bg-surface" />
        <View className="my-1 w-[2px] flex-1 rounded-full bg-edge-strong" />
        <View className="h-2.5 w-2.5 rounded-full bg-brand" />
      </View>
      <View className="flex-1 justify-between gap-4">
        <View className="flex-row items-baseline justify-between gap-2">
          <Text className="flex-1 text-base font-sans-sb text-ink" numberOfLines={1}>
            {origin}
          </Text>
          <Text className="text-sm text-ink-muted" style={{ fontVariant: ['tabular-nums'] }}>
            {originTime}
          </Text>
        </View>
        <View className="flex-row items-baseline justify-between gap-2">
          <Text className="flex-1 text-base font-sans-sb text-ink" numberOfLines={1}>
            {destination}
          </Text>
          <Text className="text-sm text-ink-muted" style={{ fontVariant: ['tabular-nums'] }}>
            {destTime}
          </Text>
        </View>
      </View>
    </View>
  );
}

/** Compact load row for the Loads list (Upcoming / Current / Previous). */
export function LoadCard({ load, onPress }: { load: LoadSummary; onPress?: () => void }) {
  const s = LOAD_STATUS[load.status];
  return (
    <Card onPress={onPress}>
      <View className="flex-row items-center gap-2 pb-2">
        <Text className="flex-1 text-xs font-sans-sb uppercase tracking-wider text-ink-muted">
          {load.ref}
        </Text>
        {load.hazmat ? <Badge label="Hazmat" tone="warning" icon="warning" /> : null}
        <Badge label={s.label} tone={s.tone} />
      </View>
      <RouteRail
        origin={load.origin}
        originTime={load.originTime}
        destination={load.destination}
        destTime={load.destTime}
      />
      <View className="mt-3 flex-row items-center gap-2 border-t border-edge-subtle pt-3">
        <Icon name="route" size={14} className="text-ink-subtle" />
        <Text className="text-sm text-ink-muted">
          {load.stops} stops · {load.miles} · {load.equipment}
        </Text>
        <View className="flex-1" />
        {onPress ? <Icon name="chevron_right" size={20} className="text-ink-subtle" /> : null}
      </View>
    </Card>
  );
}
