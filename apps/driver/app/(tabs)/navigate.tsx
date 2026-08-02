import { useRouter } from 'expo-router';
import { NavigationScreen } from '@/features/nav/NavigationScreen';

// Navigation is a real tab surface so the bottom bar remains available while viewing the route.
export default function NavigateTab() {
  const router = useRouter();
  return <NavigationScreen onClose={() => router.replace('/home')} />;
}
