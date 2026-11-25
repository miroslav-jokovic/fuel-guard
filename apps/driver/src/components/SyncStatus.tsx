import { View } from 'react-native';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { ListRow } from './ListRow';
import { useIsOnline } from '@/lib/connectivity';
import { runSync, useSyncState } from '@/data/sync';
import { syncSubtitle } from './syncStatusModel';

export function PendingBadge() {
  const { pending, needsAttention } = useSyncState();
  // A status is a word in its colour, never a pill (Visual 2026 D-DV14, V8).
  if (needsAttention > 0) {
    return <AppText variant="supporting" weight="semibold" tone="danger" tabular>{`${needsAttention} need attention`}</AppText>;
  }
  if (pending > 0) return <AppText variant="supporting" weight="semibold" tone="warning" tabular>{`${pending} waiting`}</AppText>;
  return null;
}

export function SyncStatus() {
  const online = useIsOnline();
  const { pending, needsAttention, running, lastSyncAt } = useSyncState();
  const subtitle = syncSubtitle({ running, online, pending, needsAttention, lastSyncAt, now: Date.now() });

  return (
    <ListRow
      icon={running ? 'sync' : needsAttention > 0 ? 'sync_problem' : online ? 'cloud_done' : 'cloud_off'}
      // A verb: the row runs a sync, and its section is already labelled "Sync" (V9 critique).
      title="Sync now"
      subtitle={subtitle}
      disabled={running}
      onPress={() => { void runSync(); }}
      right={
        needsAttention > 0 ? (
          <AppText variant="supporting" weight="semibold" tone="danger" tabular>{`${needsAttention} failed`}</AppText>
        ) : pending > 0 ? (
          <AppText variant="supporting" weight="semibold" tone="warning" tabular>{`${pending} waiting`}</AppText>
        ) : (
          <Icon name="refresh" size={20} className="text-ink-secondary" />
        )
      }
    />
  );
}

export function NeedsAttentionNote() {
  const { needsAttention } = useSyncState();
  if (needsAttention === 0) return null;
  return (
    <View
      className="min-h-11 flex-row items-start gap-2 rounded-lg bg-danger-soft px-3 py-2"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Icon name="sync_problem" size={18} className="mt-0.5 text-sync-failed" />
      <AppText variant="supporting" tone="secondary" className="flex-1">
        {needsAttention} {needsAttention === 1 ? 'item' : 'items'} couldn’t sync. Your work is safe;
        open Settings › Sync to retry.
      </AppText>
    </View>
  );
}
