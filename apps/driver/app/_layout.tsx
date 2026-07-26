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
  // Stringify so the effect only fires when the actual path changes,
  // not on every new array reference expo-router produces each render.
  const segmentsKey = segments.join('/');

  useEffect(() => {
    if (status === 'loading') return;
    // Cast to plain string[] — expo-router's inferred literal union is too narrow for
    // route-name comparisons and produces false "no overlap" TS errors.
    const segs = segments as string[];
    const inAuthGroup = segs[0] === '(auth)';

    if (status === 'ready') {
      // Redirect to home from the splash ("/") or any auth screen.
      // segs[0] === 'index' covers the loading spinner shown while the session restores.
      if (inAuthGroup || segs[0] === 'index' || segs[0] === '') router.replace('/home');
      return;
    }

    const target =
      status === 'signedOut' ? '/sign-in' : status === 'pending' ? '/pending' : '/wrong-app';
    const currentAuthScreen = inAuthGroup ? segs[1] : undefined;
    if (currentAuthScreen !== target.slice(1)) router.replace(target);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, segmentsKey]);
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
    MaterialSymbolsRounded: require('../assets/fonts/MaterialSymbolsRounded.ttf') as number,
    MaterialSymbolsRoundedFill: require('../assets/fonts/MaterialSymbolsRoundedFill.ttf') as number,
    MaterialSymbolsOutlined: require('../assets/fonts/MaterialSymbolsOutlined.ttf') as number,
    MaterialSymbolsOutlinedFill: require('../assets/fonts/MaterialSymbolsOutlinedFill.ttf') as number,
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
