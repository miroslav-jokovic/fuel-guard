import { useRouter } from 'expo-router';
import { Banner, Card, ListRow, Screen, Section } from '@/components';
import { useFeatures } from '@/session/useFeatures';
import { useShift } from '@/features/duty/useDuty';

/**
 * Everything that is not a tab. Duty is deliberately absent: Today owns the shift, and the two rows
 * that used to live here were a second place to change a truck — which is how a driver ends up
 * unsure which screen is telling the truth (B6.4). Notifications gets a durable entry, because a
 * bell that only exists on Today is unreachable the moment a driver is on any other tab.
 */
export default function More() {
  const router = useRouter();
  const shift = useShift();
  const { enabled, scoreDetailTab } = useFeatures();
  const hazmatEnabled = enabled('hazmat.capture');
  const messagesEnabled = enabled('messages');
  const scoreEnabled = enabled('tab.score');
  const notificationsEnabled = enabled('notifications');

  return (
    <Screen flow="sections">
      <Section first title="More">
        {shift.isError && !shift.data ? (
          <Banner
            tone="danger"
            message="Could not verify your current shift."
            actionLabel="Retry"
            onAction={() => void shift.refetch()}
          />
        ) : null}
      </Section>

      {messagesEnabled ? (
        <Section title="Support">
          <Card variant="flat" padded={false}>
            <ListRow
              title="Message dispatch"
              subtitle="Start or continue a conversation with your fleet"
              icon="mail"
              disc="info"
              onPress={() => router.push('/messages')}
            />
          </Card>
        </Section>
      ) : null}

      {scoreEnabled && !scoreDetailTab ? (
        <Section title="Performance">
          <Card variant="flat" padded={false}>
            <ListRow
              title="Driver score"
              subtitle="Weekly breakdown and coaching"
              icon="speed"
              disc="success"
              onPress={() => router.push('/score')}
            />
          </Card>
        </Section>
      ) : null}

      {hazmatEnabled ? (
        <Section title="Work tools">
          <Card variant="flat" padded={false}>
            <ListRow
              title="Hazmat checks"
              subtitle="Capture a BOL and review compliance results"
              icon="local_fire_department"
              disc="danger"
              onPress={() => router.push('/hazmat')}
            />
          </Card>
        </Section>
      ) : null}

      <Section title="App">
        <Card variant="flat" padded={false}>
          <ListRow
            title="Settings"
            subtitle="Appearance, sync, account, and diagnostics"
            icon="settings"
            disc="neutral"
            onPress={() => router.push('/settings')}
          />
          {notificationsEnabled ? (
            <ListRow
              title="Notifications"
              subtitle="Everything dispatch has sent you"
              icon="notifications"
              disc="neutral"
              onPress={() => router.push('/notifications')}
            />
          ) : null}
          {__DEV__ ? (
            <ListRow
              title="Design system"
              subtitle="Component gallery · development builds"
              icon="explore"
              disc="neutral"
              onPress={() => router.push('/gallery')}
            />
          ) : null}
        </Card>
      </Section>
    </Screen>
  );
}
