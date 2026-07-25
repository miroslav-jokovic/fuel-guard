import { useRouter } from 'expo-router';
import { ListRow, Screen } from '@/components';

export default function More() {
  const router = useRouter();
  return (
    <Screen>
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
      <ListRow title="Training" subtitle="Coming soon" icon="school" />
      <ListRow title="HazmatGuard" subtitle="Coming soon" icon="local_fire_department" />
    </Screen>
  );
}
