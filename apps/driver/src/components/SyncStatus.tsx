import { View } from 'react-native';
import { AppText } from './AppText';
import { Badge } from './Badge';
import { Icon } from './Icon';
import { ListRow } from './ListRow';
import { useIsOnline } from '@/lib/connectivity';
import { runSync, useSyncState } from '@/data/sync';

function relativeTime(ts: number | null): string {
  if (!ts) return 'not yet';
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

export function PendingBadge() {
  const { pending, needsAttention } = useSyncState();
  if (needsAttention > 0) {
    return <Badge label={`${needsAttention} needs attention`} tone="danger" icon="sync_problem" />;
  }
  if (pending > 0) return <Badge label={`${pending} pending`} tone="info" dot />;
  return null;
}

export function SyncStatus() {
  const online = useIsOnline();
  const { pending, needsAttention, running, lastSyncAt } = useSyncState();
  const subtitle = running
    ? 'Syncing now…'
    : !online
      ? `Offline · last synced ${relativeTime(lastSyncAt)}`
      : pending > 0
        ? `${pending} waiting · last synced ${relativeTime(lastSyncAt)}`
        : `All synced · ${relativeTime(lastSyncAt)}`;

  return (
    <ListRow
      icon={running ? 'sync' : needsAttention > 0 ? 'sync_problem' : online ? 'cloud_done' : 'cloud_off'}
      title="Sync"
      subtitle={subtitle}
      onPress={() => { void runSync(); }}
      right={
        needsAttention > 0 ? (
          <Badge label={String(needsAttention)} tone="danger" />
        ) : pending > 0 ? (
          <Badge label={String(pending)} tone="info" />
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
    <View className="min-h-11 flex-row items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 px-3 py-2.5">
      <Icon name="sync_problem" size={18} className="mt-0.5 text-sync-failed" />
      <AppText variant="supporting" tone="secondary" className="flex-1">
        {needsAttention} {needsAttention === 1 ? 'item' : 'items'} couldn’t sync. Your work is safe;
        open Settings › Sync to retry.
      </AppText>
    </View>
  );
}
