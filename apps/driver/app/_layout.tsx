import '../global.css';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/theme/ThemeProvider';

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    MaterialSymbolsRounded: require('../assets/fonts/MaterialSymbolsRounded.ttf'),
    MaterialSymbolsRoundedFill: require('../assets/fonts/MaterialSymbolsRoundedFill.ttf'),
    MaterialSymbolsOutlined: require('../assets/fonts/MaterialSymbolsOutlined.ttf'),
    MaterialSymbolsOutlinedFill: require('../assets/fonts/MaterialSymbolsOutlinedFill.ttf'),
  });

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="log-fuel" options={{ presentation: 'modal' }} />
            <Stack.Screen name="gallery" options={{ presentation: 'modal', headerShown: true, title: 'Design system' }} />
          </Stack>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
