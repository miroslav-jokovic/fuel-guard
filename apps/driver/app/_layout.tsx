import '../global.css';
import { useEffect } from 'react';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { SessionProvider, useSession } from '@/features/auth/SessionProvider';

/**
 * Redirect the user to the surface their session state allows, reactively (sign-out from anywhere
 * bounces to sign-in; a fresh sign-in lands on Home). RLS + requireRole are the real boundary — this
 * is the navigation mirror of that (plan §3.2).
 */
function useProtectedRoute() {
  const { status } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;
    const inAuthGroup = segments[0] === '(auth)';

    if (status === 'ready') {
      // A driver with an org must be inside the app, never on the splash or an auth screen.
      if (inAuthGroup || segments.length === 0) router.replace('/home');
      return;
    }

    const target =
      status === 'signedOut' ? '/sign-in' : status === 'pending' ? '/pending' : '/wrong-app';
    const currentAuthScreen = inAuthGroup ? segments[1] : undefined;
    if (currentAuthScreen !== target.slice(1)) router.replace(target);
  }, [status, segments, router]);
}

function RootNavigator() {
  useProtectedRoute();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="log-fuel" options={{ presentation: 'modal' }} />
      <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
      <Stack.Screen
        name="gallery"
        options={{ presentation: 'modal', headerShown: true, title: 'Design system' }}
      />
    </Stack>
  );
}

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
          <SessionProvider>
            <RootNavigator />
          </SessionProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
