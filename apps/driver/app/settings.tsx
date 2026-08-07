import { Text } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Banner,
  Button,
  Card,
  ListRow,
  Screen,
  ScreenHeader,
  SectionLabel,
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

type ThemeMode = 'system' | 'light' | 'dark';

export default function Settings() {
  const router = useRouter();
  const { email, role, signOut } = useSession();
  const { mode, setMode } = useTheme();
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
    <Screen padTop={false}>
      <ScreenHeader title="Settings" onClose={() => router.back()} />

      <SectionLabel>Account</SectionLabel>
      <ListRow
        icon="account_circle"
        iconFill
        title={email ?? 'Signed in'}
        subtitle={role ? `Role: ${role}` : undefined}
      />

      <SectionLabel>Data</SectionLabel>
      <SyncStatus />
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

      <SectionLabel>Appearance</SectionLabel>
      <Card>
        <Text className="pb-2 text-sm font-sans-md text-ink-secondary">Theme</Text>
        <SegmentedControl<ThemeMode>
          value={mode}
          onChange={setMode}
          options={[
            { label: 'System', value: 'system' },
            { label: 'Light', value: 'light' },
            { label: 'Dark', value: 'dark' },
          ]}
        />
        <Text className="pt-2 text-xs text-ink-muted">
          System follows your phone. Dark mode is easier on the eyes in a night cab.
        </Text>
      </Card>

      {__DEV__ ? (
        <>
          <SectionLabel>Developer</SectionLabel>
          <ListRow
            icon="bolt"
            title="Queue a test sync item"
            subtitle={`Outbox: ${pending} pending · turn on airplane mode first to see it queue`}
            onPress={() => {
              void seedTestSync();
            }}
          />
        </>
      ) : null}

      <BuildInfoCard />

      <SectionLabel>Session</SectionLabel>
      <Button
        label="Sign out"
        variant="secondary"
        icon="logout"
        onPress={() => {
          void signOutWithRevoke();
        }}
      />

      <SectionLabel>Your account</SectionLabel>
      <ListRow
        icon="badge"
        title="Company-issued login"
        subtitle="Your fleet manages this account. To change or close it, contact your fleet manager."
      />
    </Screen>
  );
}
