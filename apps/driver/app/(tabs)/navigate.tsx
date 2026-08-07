import { Redirect, useRouter } from 'expo-router';
import { NavigationScreen } from '@/features/nav/NavigationScreen';

/**
 * Reserved navigation seam (D52 — the nav programme owns this surface). The tab is hidden
 * (`href: null` in the tabs layout); the route itself only renders in DEV builds so the NP0
 * sample-route spike can never appear in production as if it were live data (Phase 2 real-data
 * guarantee). NP1 replaces the preview with the live server route for the accepted load.
 */
export default function NavigateTab() {
  const router = useRouter();
  if (!__DEV__) return <Redirect href="/home" />;
  return <NavigationScreen onClose={() => router.replace('/home')} />;
}
