import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, ListRow, Screen, SegmentedControl } from '@/components';
import { apiFetch } from '@/lib/api';
import { useSession } from '@/features/auth/SessionProvider';
import { useTheme } from '@/theme/ThemeProvider';

type ThemeMode = 'system' | 'light' | 'dark';

function SectionLabel({ children }: { children: string }) {
  return <Text className="px-1 pt-2 text-xs uppercase tracking-wide text-ink-muted">{children}</Text>;
}

export default function Settings() {
  const router = useRouter();
  const { email, role, signOut } = useSession();
  const { mode, setMode } = useTheme();
  const [deleting, setDeleting] = useState(false);

  async function deleteAccount() {
    setDeleting(true);
    const res = await apiFetch('/api/me/delete-account', { method: 'POST' });
    if (res.ok) {
      await signOut(); // the root guard bounces to sign-in
      return;
    }
    setDeleting(false);
    Alert.alert('Couldn’t delete account', res.error?.message ?? 'Please try again in a moment.');
  }

  function confirmDelete() {
    Alert.alert(
      'Delete your account?',
      'This permanently removes your driver login and unlinks you from your fleet. Your past fuel entries stay with the fleet for their records. This can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: () => {
            void deleteAccount();
          },
        },
      ],
    );
  }

  return (
    <Screen>
      <View className="flex-row items-center justify-between">
        <Text className="text-xl font-bold text-ink">Settings</Text>
        <Button label="Done" variant="ghost" size="sm" onPress={() => router.back()} />
      </View>

      <SectionLabel>Account</SectionLabel>
      <ListRow
        icon="account_circle"
        iconFill
        title={email ?? 'Signed in'}
        subtitle={role ? `Role: ${role}` : undefined}
      />

      <SectionLabel>Appearance</SectionLabel>
      <Card>
        <Text className="pb-2 text-sm font-medium text-ink-secondary">Theme</Text>
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

      <SectionLabel>Session</SectionLabel>
      <Button
        label="Sign out"
        variant="secondary"
        icon="logout"
        onPress={() => {
          void signOut();
        }}
      />

      <View className="pt-6 gap-1">
        <Pressable
          accessibilityRole="button"
          disabled={deleting}
          onPress={confirmDelete}
          className="min-h-[48px] items-center justify-center rounded-md active:bg-surface-subtle"
        >
          <Text className="font-medium text-danger">
            {deleting ? 'Deleting…' : 'Delete account'}
          </Text>
        </Pressable>
        <Text className="text-center text-xs text-ink-muted">
          Permanently removes your login. Your fuel history stays with your fleet.
        </Text>
      </View>
    </Screen>
  );
}
