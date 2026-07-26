import { useRouter } from 'expo-router';
import { Badge, ListRow, Screen, ScreenHeader, SectionLabel } from '@/components';

export default function More() {
  const router = useRouter();
  return (
    <Screen>
      <ScreenHeader title="More" />

      <SectionLabel>App</SectionLabel>
      <ListRow
        title="Settings"
        subtitle="Profile, appearance, sign out"
        icon="settings"
        onPress={() => router.push('/settings')}
      />
      <ListRow
        title="Design system"
        subtitle="Component gallery (dev)"
        icon="explore"
        onPress={() => router.push('/gallery')}
      />

      <SectionLabel>Coming soon</SectionLabel>
      <ListRow
        title="Training"
        subtitle="Safety courses & quizzes"
        icon="school"
        right={<Badge label="Soon" tone="info" />}
      />
      <ListRow
        title="HazmatGuard"
        subtitle="Hazmat documentation in your load flow"
        icon="local_fire_department"
        right={<Badge label="Soon" tone="info" />}
      />
      <ListRow
        title="Ask FuelGuard"
        subtitle="AI copilot for your loads, route & score"
        icon="bolt"
        right={<Badge label="Soon" tone="info" />}
      />
    </Screen>
  );
}
