import { Redirect, useRouter } from 'expo-router';
import { NavigationScreen } from '@/features/nav/NavigationScreen';

// Navigation modal seam (D52): DEV-only until the nav programme lands the live route (NP1) —
// production must never present the NP0 sample route/fuel stops as real data (Phase 2 guarantee).
export default function Drive() {
  const router = useRouter();
  if (!__DEV__) return <Redirect href="/home" />;
  return <NavigationScreen onClose={() => router.back()} />;
}
