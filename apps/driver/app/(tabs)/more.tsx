import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppText, Avatar, Banner, Card, ListRow, Screen, ScreenHeader, Section } from '@/components';
import { useFeatures } from '@/session/useFeatures';
import { useSession } from '@/session/SessionProvider';
import { useDriverContext } from '@/session/useDriverContext';
import { useShift } from '@/features/duty/useDuty';
import { revokePushRegistration } from '@/features/notifications/push';

/**
 * Everything that is not a tab, in three groups the owner named on 2026-09-07 (D-DB14): who is
 * signed in and the way out, the work surfaces that are not tabs, and the settings.
 *
 * Sign out lives HERE, on the account card, not two screens down inside System settings — a driver
 * handing a shared cab phone to the next driver should not have to hunt for it. Duty is deliberately
 * absent: Today owns the shift, and a second place to change a truck is how a driver ends up unsure
 * which screen is telling the truth (B6.4). Documents is a tab and has no row here for the same
 * reason. Notifications keeps a durable entry, because a bell that only exists on Today is
 * unreachable the moment a driver is on any other tab.
 */
export default function More() {
  const router = useRouter();
  const shift = useShift();
  const driver = useDriverContext();
  const { email, role, signOut } = useSession();
  const { enabled } = useFeatures();
  const hazmatEnabled = enabled('hazmat.capture');
  const messagesEnabled = enabled('messages');
  const scoreEnabled = enabled('tab.score');
  const notificationsEnabled = enabled('notifications');

  /** Sign-out revokes this device's push token FIRST, while the session can still authenticate the
   *  call — otherwise the phone keeps receiving fleet content (D53). Best-effort with a 3s cap. */
  async function signOutWithRevoke() {
    await revokePushRegistration();
    await signOut();
  }

  const name = driver.data?.driver.full_name ?? email ?? 'Signed in';

  return (
    <Screen flow="sections">
      <ScreenHeader title="More" />

      <Section first>
        {shift.isError && !shift.data ? (
          <Banner
            tone="danger"
            message="Could not verify your current shift."
            actionLabel="Retry"
            onAction={() => void shift.refetch()}
          />
        ) : null}
        <Card padded={false}>
          <View className="flex-row items-center gap-3 px-4 py-4">
            <Avatar name={name} size={48} />
            <View className="flex-1 gap-0.5">
              <AppText variant="rowTitle" numberOfLines={1}>{name}</AppText>
              <AppText variant="supporting" tone="muted" numberOfLines={1}>
                {[email, role ? `Role: ${role}` : null].filter(Boolean).join(' · ')}
              </AppText>
            </View>
          </View>
          <View className="ml-4 h-px bg-edge-subtle" />
          <ListRow
            icon="badge"
            disc="neutral"
            title="Company-issued login"
            subtitle="Your fleet manages this account. Ask your fleet manager to change or close it."
          />
          <View className="ml-18 h-px bg-edge-subtle" />
          <ListRow
            icon="logout"
            disc="danger"
            title="Sign out"
            destructive
            onPress={() => { void signOutWithRevoke(); }}
          />
        </Card>
      </Section>

      {scoreEnabled || messagesEnabled || notificationsEnabled ? (
        <Section title="Work">
          <Card padded={false}>
            {scoreEnabled ? (
              <ListRow
                title="Driver score"
                subtitle="Your week, what made the grade, and the next opportunity"
                icon="speed"
                disc="success"
                onPress={() => router.push('/score')}
              />
            ) : null}
            {scoreEnabled && messagesEnabled ? <View className="ml-18 h-px bg-edge-subtle" /> : null}
            {messagesEnabled ? (
              <ListRow
                title="Messages"
                subtitle="You and dispatch"
                icon="mail"
                disc="info"
                onPress={() => router.push('/messages')}
              />
            ) : null}
            {(scoreEnabled || messagesEnabled) && notificationsEnabled ? <View className="ml-18 h-px bg-edge-subtle" /> : null}
            {notificationsEnabled ? (
              <ListRow
                title="Notifications"
                subtitle="Everything dispatch has sent you"
                icon="notifications"
                disc="neutral"
                onPress={() => router.push('/notifications')}
              />
            ) : null}
          </Card>
        </Section>
      ) : null}

      <Section title="Settings">
        <Card padded={false}>
          <ListRow
            title="System settings"
            subtitle="Appearance, contrast, sync and build"
            icon="settings"
            disc="neutral"
            onPress={() => router.push('/settings')}
          />
          {hazmatEnabled ? (
            <>
              <View className="ml-18 h-px bg-edge-subtle" />
              <ListRow
                title="Scanner settings"
                subtitle="How documents are captured on this phone"
                icon="qr_code_scanner"
                disc="action"
                onPress={() => router.push('/scanner-settings')}
              />
            </>
          ) : null}
          {__DEV__ ? (
            <>
              <View className="ml-18 h-px bg-edge-subtle" />
              <ListRow
                title="Design system"
                subtitle="Component gallery · development builds"
                icon="explore"
                disc="neutral"
                onPress={() => router.push('/gallery')}
              />
            </>
          ) : null}
        </Card>
      </Section>
    </Screen>
  );
}
