import { View, useWindowDimensions } from 'react-native';
import { AppText, Badge, Button, Card, Icon, Skeleton } from '@/components';
import type { DutyView } from './useDuty';
import { layout } from '@/theme/tokens';

function sinceLabel(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

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
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale >= layout.largeTextBreakpoint;
  if (loading) return <Skeleton className="h-28 w-full rounded-xl" />;

  if (!duty.onDuty) {
    return (
      <Card variant="operational">
        <View className="flex-row items-start gap-3">
          <Icon name="local_shipping" size={22} className="mt-0.5 text-operation-current" />
          <View className="flex-1 gap-0.5">
            <AppText variant="navigationTitle">Start your day</AppText>
            <AppText variant="supporting" tone="muted">Confirm the truck and trailer you’re using.</AppText>
          </View>
        </View>
        <Button label="Confirm equipment" icon="play_circle" size="lg" onPress={onStart} />
      </Card>
    );
  }

  const since = sinceLabel(duty.startedAt);
  return (
    <Card>
      <View className="flex-row flex-wrap items-center gap-2">
        <Badge label={pending ? 'Syncing' : 'On duty'} tone={pending ? 'info' : 'success'} dot />
        {since ? <AppText variant="caption" tone="muted" tabular>Since {since}</AppText> : null}
      </View>
      <View className="flex-row items-start gap-3 border-t border-edge-subtle pt-3">
        <Icon name="local_shipping" size={21} fill className="text-ink-secondary" />
        <View className="flex-1 gap-0.5">
          <AppText variant="rowTitle">{duty.equipmentLabel ?? 'Truck confirmed'}</AppText>
          <AppText variant="supporting" tone={duty.hasTrailer ? 'muted' : 'warning'}>
            {duty.hasTrailer ? 'Truck and trailer confirmed' : 'Bobtail · add a trailer before loading'}
          </AppText>
        </View>
        <Icon
          name={duty.hasTrailer ? 'check_circle' : 'info'}
          size={19}
          className={duty.hasTrailer ? 'text-operation-complete' : 'text-warning'}
        />
      </View>
      <View className={largeText ? 'gap-2' : 'flex-row gap-2'}>
        <View className={largeText ? '' : 'flex-1'}><Button label="Change" variant="secondary" size="sm" icon="edit" onPress={onChange} /></View>
        {onEnd ? <View className={largeText ? '' : 'flex-1'}><Button label="End shift" variant="ghost" size="sm" icon="logout" onPress={onEnd} /></View> : null}
      </View>
    </Card>
  );
}
