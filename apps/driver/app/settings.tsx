import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Banner,
  Button,
  Card,
  ConfirmSheet,
  ListRow,
  Screen,
  ScreenHeader,
  SectionLabel,
  SegmentedControl,
  SyncStatus,
} from '@/components';
import { apiFetch } from '@/lib/api';
import { useSession } from '@/session/SessionProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { enqueue } from '@/data/outbox';
import { runSync, useSyncState } from '@/data/sync';
import { DEV_PING_KIND } from '@/data/handlers';
import { revokePushRegistration } from '@/features/notifications/push';
import { haptics } from '@/lib/haptics';

type ThemeMode = 'system' | 'light' | 'dark';

export default function Settings() {
  const router = useRouter();
  const { email, role, signOut } = useSession();
  const { mode, setMode } = useTheme();
  const { pending, needsAttention, lastError } = useSyncState();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  /** Sign-out and delete both revoke this device's push token FIRST, while the session can still
   *  authenticate the call — otherwise the phone keeps receiving fleet content (D53). Best-effort
   *  with a 3s cap; offboarding revokes server-side as the backstop (members.ts). */
  async function signOutWithRevoke() {
    await revokePushRegistration();
    await signOut();
  }

  async function deleteAccount() {
    setDeleting(true);
    setDeleteError(null);
    await revokePushRegistration();
    const res = await apiFetch('/api/me/delete-account', { method: 'POST' });
    if (res.ok) {
      await signOut(); // the root guard bounces to sign-in
      return;
    }
    setDeleting(false);
    setConfirming(false);
    setDeleteError(res.error?.message ?? 'Couldn’t delete your account. Please try again in a moment.');
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

      <SectionLabel>Session</SectionLabel>
      <Button
        label="Sign out"
        variant="secondary"
        icon="logout"
        onPress={() => {
          void signOutWithRevoke();
        }}
      />

      {deleteError ? <Banner tone="danger" message={deleteError} /> : null}

      <View className="gap-1 pt-6">
        <Pressable
          accessibilityRole="button"
          disabled={deleting}
          onPress={() => setConfirming(true)}
          className="min-h-[48px] items-center justify-center rounded-xl active:bg-surface-subtle"
        >
          <Text className="font-sans-md text-danger">
            {deleting ? 'Deleting…' : 'Delete account'}
          </Text>
        </Pressable>
        <Text className="text-center text-xs text-ink-muted">
          Permanently removes your login. Your work history stays with your fleet.
        </Text>
      </View>

      <ConfirmSheet
        visible={confirming}
        tone="danger"
        icon="delete"
        title="Delete your account?"
        message="This permanently removes your driver login and unlinks you from your fleet. Your work history stays with the fleet for their records. This can’t be undone."
        confirmLabel="Delete account"
        loading={deleting}
        onConfirm={() => {
          void deleteAccount();
        }}
        onCancel={() => {
          if (!deleting) setConfirming(false);
        }}
      />
    </Screen>
  );
}
