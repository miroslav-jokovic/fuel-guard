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
import { useSession } from '@/session/SessionProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { enqueue } from '@/data/outbox';
import { runSync, useSyncState } from '@/data/sync';
import { DEV_PING_KIND } from '@/data/handlers';
import { revokePushRegistration } from '@/features/notifications/push';
import { haptics } from '@/lib/haptics';
import { BuildInfoCard } from '@/features/support/BuildInfoCard';
import { FailedSyncList } from '@/features/support/FailedSyncList';

type ThemeMode = 'system' | 'light' | 'dark';

export default function Settings() {
  const router = useRouter();
  const { email, role, signOut } = useSession();
  const { mode, setMode, contrastMode, setContrastMode } = useTheme();
  const { pending, needsAttention, lastError } = useSyncState();

  /** Sign-out revokes this device's push token FIRST, while the session can still authenticate the
   *  call — otherwise the phone keeps receiving fleet content (D53). Best-effort with a 3s cap. */
  async function signOutWithRevoke() {
    await revokePushRegistration();
    await signOut();
  }

  /** Seeded test mutation (plan §13.1) — proves enqueue → relaunch → drain end-to-end. */
  async function seedTestSync() {
    await enqueue({ kind: DEV_PING_KIND, payload: { at: Date.now() } });
    haptics.success();
    void runSync();
  }

  return (
    <Screen padTop={false} flow="sections">
      <ScreenHeader title="Settings" onClose={() => router.back()} />

      {/* B6.5: the three account-ish groups collapse into one. "Account", "Session" and "Your
          account" were three headings for one subject, and the sign-out lived two screens-worth of
          scrolling away from the identity it signs out of. */}
      <Section first title="Account">
        <Card variant="flat" padded={false}>
          <ListRow
            icon="account_circle"
            iconFill
            disc="neutral"
            title={email ?? 'Signed in'}
            subtitle={role ? `Role: ${role}` : undefined}
          />
          <ListRow
            icon="badge"
            disc="neutral"
            title="Company-issued login"
            subtitle="Your fleet manages this account. Contact your fleet manager to change or close it."
          />
          <ListRow
            icon="logout"
            disc="danger"
            title="Sign out"
            destructive
            onPress={() => { void signOutWithRevoke(); }}
          />
        </Card>
      </Section>

      <Section title="Sync">
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
