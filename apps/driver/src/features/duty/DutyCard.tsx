import { Text, View } from 'react-native';
import { Badge, Button, Card, Icon, ListRow, Skeleton } from '@/components';
import type { DutyView } from './useDuty';

/** "since 06:12" — the driver's own clock, tabular so the digits don't jitter between renders. */
function sinceLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * Home's first card — the D44 staged soft gate made visible. Three states, and none of them is a
 * wall: a driver may open the app at the kitchen table to look at tomorrow's load, so the pressure
 * to check in is a card, never a blocking modal.
 *
 *   off duty   → "Start your day" with the primary CTA
 *   on duty    → the live truck + trailer with Change and End actions
 *   pending    → the same, badged, while the outbox record is still in flight (D44.7)
 */
export function DutyCard({
  duty,
  pending,
  loading,
  onStart,
  onChange,
  onEnd,
}: {
  duty: DutyView;
  pending?: boolean;
  loading?: boolean;
  onStart: () => void;
  onChange: () => void;
  onEnd?: () => void;
}) {
  if (loading) {
    return <Skeleton className="h-[132px] w-full rounded-xl" />;
  }

  if (!duty.onDuty) {
    return (
      <Card>
        <View className="flex-row items-center gap-3 pb-1">
          <View className="h-10 w-10 items-center justify-center rounded-xl bg-surface-muted">
            <Icon name="local_shipping" size={22} className="text-ink" />
          </View>
          <View className="flex-1 gap-0.5">
            <Text className="text-base font-sans-sb text-ink">Start your day</Text>
            <Text className="text-sm text-ink-muted">
              Confirm the truck and trailer you&apos;re driving
            </Text>
          </View>
        </View>
        <Button
          label="Confirm my truck"
          icon="play_circle"
          size="lg"
          onPress={onStart}
          haptic="tap"
        />
      </Card>
    );
  }

  const since = sinceLabel(duty.startedAt);

  return (
    <Card>
      <View className="flex-row items-center gap-2 pb-1">
        <Badge label={pending ? 'Syncing' : 'On duty'} tone={pending ? 'info' : 'success'} dot />
        {since ? (
          <Text
            className="text-xs font-sans-md text-ink-muted"
            style={{ fontVariant: ['tabular-nums'] }}
          >
            since {since}
          </Text>
        ) : null}
        <View className="flex-1" />
        <Button label="Change" variant="ghost" size="sm" icon="edit" onPress={onChange} />
        {onEnd ? (
          <Button label="End" variant="ghost" size="sm" icon="logout" onPress={onEnd} />
        ) : null}
      </View>

      <ListRow
        icon="local_shipping"
        iconFill
        title={duty.equipmentLabel ?? 'Truck confirmed'}
        subtitle={
          duty.hasTrailer ? 'Truck and trailer confirmed' : 'No trailer — add one before you load'
        }
        right={
          duty.hasTrailer ? (
            <Icon name="check_circle" size={20} className="text-success" />
          ) : (
            <Icon name="info" size={20} className="text-caution" />
          )
        }
      />
    </Card>
  );
}
