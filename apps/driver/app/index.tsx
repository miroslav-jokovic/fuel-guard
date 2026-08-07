import { ActivityIndicator, View } from 'react-native';
import { roleColors } from '@/theme/colors';
import { useTheme } from '@/theme/ThemeProvider';

// Splash shown at "/" while the persisted session is restored. The root guard (app/_layout) then
// redirects to Home, sign-in, pending, or wrong-app based on session status — this screen never
// navigates itself, so there's no flash of the wrong surface.
export default function Index() {
  const { themeKey } = useTheme();
  return (
    <View className="flex-1 items-center justify-center bg-canvas">
      <ActivityIndicator color={roleColors[themeKey].brand} />
    </View>
  );
}
