import { useRouter } from 'expo-router';
import { NavigationScreen } from '@/features/nav/NavigationScreen';

// Navigation modal (Phase 4 shell): opened by the load's Navigate CTA.
// Shows the planned route + fuel stops as an honest schematic preview; Phase 4 swaps the preview
// panel for the live MapLibre view over the server's HERE route (plan §8/§15) and makes the fuel
// stops live plan data.
export default function Drive() {
  const router = useRouter();
  return <NavigationScreen onClose={() => router.back()} />;
}
