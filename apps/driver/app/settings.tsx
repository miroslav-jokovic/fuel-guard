import { View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Banner,
  AppText,
  GroupedList,
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
    <Screen padTop={false}>
      <ScreenHeader title="Settings" onClose={() => router.back()} />

      <SectionLabel>Account</SectionLabel>
      <GroupedList>
        <ListRow
          icon="account_circle"
          iconFill
          title={email ?? 'Signed in'}
          subtitle={role ? `Role: ${role}` : undefined}
        />
      </GroupedList>

      <SectionLabel>Data</SectionLabel>
      <GroupedList><SyncStatus /></GroupedList>
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
      <View className="gap-4 rounded-xl border border-edge-subtle bg-surface p-4">
        <View className="gap-2">
          <AppText variant="sectionTitle">Theme</AppText>
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
          <AppText variant="sectionTitle">Contrast</AppText>
          <SegmentedControl
            value={contrastMode}
            onChange={setContrastMode}
            options={[
              { label: 'System', value: 'system' },
              { label: 'Standard', value: 'standard' },
              { label: 'High', value: 'high' },
            ]}
          />
          <AppText variant="caption" tone="muted">High contrast strengthens text, borders, and operational states.</AppText>
        </View>
      </View>

      {__DEV__ ? (
        <>
          <SectionLabel>Developer</SectionLabel>
          <GroupedList>
            <ListRow
              icon="bolt"
              title="Queue a test sync item"
              subtitle={`Outbox: ${pending} pending · turn on airplane mode first to see it queue`}
              onPress={() => { void seedTestSync(); }}
            />
          </GroupedList>
        </>
      ) : null}

      <BuildInfoCard />

      <SectionLabel>Session</SectionLabel>
      <GroupedList>
        <ListRow icon="logout" title="Sign out" destructive onPress={() => { void signOutWithRevoke(); }} />
      </GroupedList>

      <SectionLabel>Your account</SectionLabel>
      <GroupedList>
        <ListRow
          icon="badge"
          title="Company-issued login"
          subtitle="Your fleet manages this account. Contact your fleet manager to change or close it."
        />
      </GroupedList>
    </Screen>
  );
}
