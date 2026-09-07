import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { AppText, Button, Card, ListRow } from '@/components';
import { listUnfinished, retryNow } from '@/data/outbox';
import {
  DEV_PING_KIND,
  HAZMAT_CAPTURE_KIND,
  LOAD_ACCEPT_KIND,
  LOAD_DECLINE_KIND,
  LOAD_START_KIND,
  LOAD_STOP_KIND,
  MESSAGE_SEND_KIND,
  MESSAGE_THREAD_KIND,
  SHIFT_END_KIND,
  SHIFT_EQUIPMENT_KIND,
  SHIFT_START_KIND,
} from '@/data/handlers';
import type { OutboxRecord } from '@/data/policy';
import { runSync, useSyncState } from '@/data/sync';

/**
 * What each queued record was, in the driver's words. Keyed off the kind CONSTANTS rather than their
 * string values, so renaming a kind is a compile error here instead of a row that silently falls
 * back to `hazmat_capture` on a screen a driver reads when something has already gone wrong.
 */
const KIND_LABEL: Record<string, string> = {
  [SHIFT_START_KIND]: 'Starting your shift',
  [SHIFT_END_KIND]: 'Ending your shift',
  [SHIFT_EQUIPMENT_KIND]: 'Changing your equipment',
  [LOAD_ACCEPT_KIND]: 'Accepting a load',
  [LOAD_DECLINE_KIND]: 'Declining a load',
  [LOAD_START_KIND]: 'Starting a load',
  [LOAD_STOP_KIND]: 'Completing a stop',
  [HAZMAT_CAPTURE_KIND]: 'A hazmat BOL check',
  [MESSAGE_THREAD_KIND]: 'Starting a conversation',
  [MESSAGE_SEND_KIND]: 'Sending a message',
  [DEV_PING_KIND]: 'Test item',
};

/**
 * The records that could not be sent, one row each, with a retry.
 *
 * Until now "2 items couldn't sync" was the whole story: a driver was told something failed and
 * given a single global retry that either fixed everything or fixed nothing, with no way to see WHAT
 * was stuck. A stop completion and a shift start are very different things to have lost, and the
 * driver is the only person who can judge which matters.
 */
export function FailedSyncList() {
  const { needsAttention } = useSyncState();
  const [rows, setRows] = useState<OutboxRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const all = await listUnfinished();
    setRows(all.filter((r) => r.status === 'failed' || r.status === 'dead'));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, needsAttention]);

  if (rows.length === 0) return null;

  return (
    <Card variant="flat" padded={false}>
      {rows.map((row, index) => (
        <View key={row.id}>
          <ListRow
            icon="sync_problem"
            disc="danger"
            title={KIND_LABEL[row.kind] ?? row.kind}
            subtitle={row.lastError ?? 'It will retry on its own when you have signal.'}
            right={
              <Button
                label="Retry"
                variant="secondary"
                size="sm"
                loading={busy === row.id}
                onPress={() => {
                  setBusy(row.id);
                  void retryNow(row.id)
                    .then(() => runSync())
                    .finally(() => {
                      setBusy(null);
                      void refresh();
                    });
                }}
              />
            }
          />
          {index < rows.length - 1 ? <View className="ml-18 h-px bg-edge-subtle" /> : null}
        </View>
      ))}
      <View className="px-4 pb-3 pt-1">
        <AppText variant="caption" tone="subtle">
          Nothing here is lost — every item stays on this phone until it lands.
        </AppText>
      </View>
    </Card>
  );
}
