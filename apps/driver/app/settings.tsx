import { View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Banner,
  AppText,
  Card,
  ListRow,
  Screen,
  ScreenHeader,
  Section,
  SegmentedControl,
  SyncStatus,
} from '@/components';
import { useTheme } from '@/theme/ThemeProvider';
import { enqueue } from '@/data/outbox';
import { runSync, useSyncState } from '@/data/sync';
import { DEV_PING_KIND } from '@/data/handlers';
import { haptics } from '@/lib/haptics';
import { BuildInfoCard } from '@/features/support/BuildInfoCard';
import { FailedSyncList } from '@/features/support/FailedSyncList';

type ThemeMode = 'system' | 'light' | 'dark';

export default function Settings() {
  const router = useRouter();
  const { mode, setMode, contrastMode, setContrastMode } = useTheme();
  const { pending, needsAttention, lastError } = useSyncState();

  /** Seeded test mutation (plan §13.1) — proves enqueue → relaunch → drain end-to-end. */
  async function seedTestSync() {
    await enqueue({ kind: DEV_PING_KIND, payload: { at: Date.now() } });
    haptics.success();
    void runSync();
  }

  return (
    <Screen padTop={false} flow="sections">
      <ScreenHeader title="System settings" subtitle="Appearance, sync and build" onClose={() => router.back()} />

      {/* The account card and Sign out moved to More on 2026-09-07 (D-DB14): a driver handing a
          shared cab phone over should not have to open a settings screen to leave it. */}
      <Section first title="Sync">
        <Card variant="flat" padded={false}><SyncStatus /></Card>
        {needsAttention > 0 && lastError ? (
          <Banner
            tone="danger"
            message={`Last sync problem: ${lastError}`}
            actionLabel="Try again"
            onAction={() => {
              void runSync();
            }}
          />
        ) : null}
        <FailedSyncList />
      </Section>

      <Section title="Appearance">
      <Card variant="flat">
        <View className="gap-2">
          <AppText variant="rowTitle">Theme</AppText>
          <SegmentedControl<ThemeMode>
            value={mode}
            onChange={setMode}
            options={[
              { label: 'System', value: 'system' },
              { label: 'Light', value: 'light' },
              { label: 'Dark', value: 'dark' },
            ]}
          />
          <AppText variant="caption" tone="muted">System follows the phone’s day and night appearance.</AppText>
        </View>
        <View className="h-px bg-edge-subtle" />
        <View className="gap-2">
          <AppText variant="rowTitle">Contrast</AppText>
          <SegmentedControl
            value={contrastMode}
            onChange={setContrastMode}
            options={[
              { label: 'System', value: 'system' },
              { label: 'Standard', value: 'standard' },
              { label: 'High', value: 'high' },
            ]}
          />
          <AppText variant="caption" tone="muted">
            System follows the phone’s supported contrast preference. High always strengthens text, borders, and
            operational states.
          </AppText>
        </View>
      </Card>
      </Section>

      <Section title="Build">
        <BuildInfoCard />
      </Section>

      {__DEV__ ? (
        <Section title="Developer">
          <Card variant="flat" padded={false}>
            <ListRow
              icon="bolt"
              disc="action"
              title="Queue a test sync item"
              subtitle={`Outbox: ${pending} pending · turn on airplane mode first to see it queue`}
              onPress={() => { void seedTestSync(); }}
            />
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}
