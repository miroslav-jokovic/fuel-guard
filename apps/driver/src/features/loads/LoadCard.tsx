import { View } from 'react-native';
import { AppText, Badge, Card, Icon, type Tone } from '@/components';

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

export const LOAD_STATUS: Record<LoadStatus, { label: string; tone: Tone; text: string; icon: 'schedule' | 'route' | 'check_circle' | 'cancel' }> = {
  upcoming: { label: 'Upcoming', tone: 'info', text: 'text-info', icon: 'schedule' },
  in_transit: { label: 'In transit', tone: 'brand', text: 'text-operation-current', icon: 'route' },
  delivered: { label: 'Delivered', tone: 'success', text: 'text-operation-complete', icon: 'check_circle' },
  canceled: { label: 'Canceled', tone: 'neutral', text: 'text-ink-muted', icon: 'cancel' },
};

/** Stable route anatomy used on every load surface. */
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
      <View className="w-4 items-center py-1">
        <View className="h-2.5 w-2.5 rounded-full border-2 border-operation-current bg-surface" />
        <View className="my-1 w-px flex-1 bg-edge-strong" />
        <View className="h-2.5 w-2.5 rounded-full bg-operation-current" />
      </View>
      <View className="flex-1 gap-3">
        <View className="flex-row items-start justify-between gap-3">
          <AppText variant="rowTitle" className="flex-1">{origin}</AppText>
          <AppText variant="caption" tone="muted" tabular className="text-right">{originTime}</AppText>
        </View>
        <View className="flex-row items-start justify-between gap-3">
          <AppText variant="rowTitle" className="flex-1">{destination}</AppText>
          <AppText variant="caption" tone="muted" tabular className="text-right">{destTime}</AppText>
        </View>
      </View>
    </View>
  );
}

export function LoadCard({ load, onPress }: { load: LoadSummary; onPress?: () => void }) {
  const status = LOAD_STATUS[load.status];
  return (
    <Card onPress={onPress}>
      <View className="flex-row items-center gap-2">
        <AppText variant="caption" tone="muted" className="flex-1 font-semibold uppercase tracking-wider">
          {load.ref}
        </AppText>
        {load.hazmat ? <Badge label="Hazmat" tone="warning" icon="warning" /> : null}
        <View className="flex-row items-center gap-1">
          <Icon name={status.icon} size={14} className={status.text} />
          <AppText variant="caption" className={`font-medium ${status.text}`}>{status.label}</AppText>
        </View>
      </View>
      <RouteRail
        origin={load.origin}
        originTime={load.originTime}
        destination={load.destination}
        destTime={load.destTime}
      />
      <View className="flex-row items-center gap-2 border-t border-edge-subtle pt-2.5">
        <Icon name="route" size={15} className="text-ink-muted" />
        <AppText variant="supporting" tone="muted" className="flex-1">
          {load.stops} stops · {load.miles} · {load.equipment}
        </AppText>
        {onPress ? <Icon name="chevron_right" size={19} className="text-ink-subtle" /> : null}
      </View>
    </Card>
  );
}
