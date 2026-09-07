import { View } from 'react-native';
import { Pressable } from 'react-native';
import { AppText, Badge, Icon } from '@/components';
import { placeLabel } from '@/features/loads/loadViewModel';
import { haptics } from '@/lib/haptics';
import type { Load } from '@silvicom/shared';

/**
 * A load the driver has not started, as one row: when it starts, where it goes, and whether it is
 * theirs yet. The day tile on the left carries the two facts a driver scans for — which day, what
 * time — in the numeric role, rather than as a 12pt caption under the title.
 */
export function UpNextRow({ load, onPress }: { load: Load; onPress: () => void }) {
  const ordered = [...load.stops].sort((a, b) => a.seq - b.seq);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const offered = load.status === 'offered';

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
        <AppText variant="numericInline" className="text-ink">{clock(first?.appointment_start ?? null)}</AppText>
      </View>
      <View className="flex-1 gap-0.5">
        <AppText variant="rowTitle" numberOfLines={1}>
          {placeLabel(first)} → {placeLabel(last)}
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
      {offered ? (
        <Badge label="Offered" tone="info" />
      ) : (
        <Icon name="chevron_right" size={20} className="text-ink-subtle" />
      )}
    </Pressable>
  );
}

/** TODAY / TOMORROW / a weekday — the words a driver uses, not a date. */
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

function clock(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export { dayTile };
