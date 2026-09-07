import { Pressable, View } from 'react-native';
import { nextStop, stopProgress, type Load } from '@silvicom/shared';
import { AppText, Icon, ListRow } from '@/components';
import { placeLabel } from './loadViewModel';
import { haptics } from '@/lib/haptics';

/**
 * The load being driven, as ONE row rather than a card.
 *
 * It is a row because Today already gives this load a hero: repeating that card here made the Loads
 * tab a second Today, and the critique's fourth defect was exactly this — every object rendered as
 * the same bordered card, so nothing on any screen had rank.
 */
export function CurrentLoadRow({ load, onPress }: { load: Load; onPress: () => void }) {
  const ordered = [...load.stops].sort((a, b) => a.seq - b.seq);
  const next = nextStop(load);
  const progress = stopProgress(load);
  const action = next?.kind === 'pickup' ? 'Pick up' : 'Deliver';

  return (
    <ListRow
      title={`${placeLabel(ordered[0])} → ${placeLabel(ordered[ordered.length - 1])}`}
      subtitle={[
        load.ref,
        `Stop ${progress.current} of ${progress.total}`,
        next ? `${action} at ${next.name}${next.appointment_end ? ` by ${clock(next.appointment_end)}` : ''}` : null,
      ].filter(Boolean).join(' · ')}
      icon="local_shipping"
      disc="action"
      onPress={onPress}
    />
  );
}

/** A finished run: what it was, when it ended, how far it went. */
export function HistoryRow({ load, onPress }: { load: Load; onPress: () => void }) {
  const ordered = [...load.stops].sort((a, b) => a.seq - b.seq);
  const canceled = load.status === 'canceled';
  return (
    <ListRow
      title={`${placeLabel(ordered[0])} → ${placeLabel(ordered[ordered.length - 1])}`}
      subtitle={[
        load.ref,
        load.completed_at ? day(load.completed_at) : null,
        load.total_miles == null ? null : `${Math.round(load.total_miles).toLocaleString()} mi`,
      ].filter(Boolean).join(' · ')}
      icon={canceled ? 'cancel' : 'check_circle'}
      disc={canceled ? 'neutral' : 'success'}
      onPress={onPress}
    />
  );
}

/**
 * A load the driver has not started. Shared with Today (B2.5) in shape but not in code: Today's row
 * lives in the Today feature and may not be imported across a feature boundary (`lint:boundaries`).
 */
export function UpcomingRow({ load, onPress }: { load: Load; onPress: () => void }) {
  const ordered = [...load.stops].sort((a, b) => a.seq - b.seq);
  const first = ordered[0];

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        haptics.select();
        onPress();
      }}
      className="flex-row items-center gap-3 rounded-xl bg-surface px-4 py-3 active:bg-surface-selected"
    >
      <View className="h-13 w-13 items-center justify-center gap-0.5 rounded-lg bg-surface-muted">
        <AppText variant="caption" tone="muted" className="font-ui-md">{dayTile(first?.appointment_start ?? null)}</AppText>
        <AppText variant="numericInline">{clock(first?.appointment_start ?? null)}</AppText>
      </View>
      <View className="flex-1 gap-0.5">
        <AppText variant="rowTitle" numberOfLines={1}>
          {placeLabel(first)} → {placeLabel(ordered[ordered.length - 1])}
        </AppText>
        <AppText variant="supporting" tone="muted" numberOfLines={1}>
          {[
            load.ref,
            load.total_miles == null ? null : `${Math.round(load.total_miles).toLocaleString()} mi`,
            load.equipment,
            load.hazmat ? 'Hazmat' : null,
          ].filter(Boolean).join(' · ')}
        </AppText>
      </View>
      <Icon name="chevron_right" size={20} className="text-ink-subtle" />
    </Pressable>
  );
}

function clock(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function day(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function dayTile(iso: string | null, now = new Date()): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const days = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000,
  );
  if (days === 0) return 'TODAY';
  if (days === 1) return 'TOMRW';
  return d.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase();
}
