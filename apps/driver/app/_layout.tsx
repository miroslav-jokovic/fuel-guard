import '../global.css';
import { useEffect } from 'react';
import { useFonts } from 'expo-font';
import {
  HankenGrotesk_400Regular,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
  HankenGrotesk_700Bold,
} from '@expo-google-fonts/hanken-grotesk';
import { Stack, useRouter, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { SessionProvider, useSession } from '@/session/SessionProvider';
import { queryClient } from '@/lib/queryClient';
import { persistOptions } from '@/lib/persist';
import { initConnectivity } from '@/lib/connectivity';
import { initSync } from '@/data/sync';
import { registerSyncHandlers } from '@/data/handlers';

// Register outbox handlers once, at module load, so a queued record can always find its handler —
// even if the engine starts before the feature screen that enqueues it has ever mounted.
registerSyncHandlers();

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
    // Cast to plain string[] — expo-router's inferred literal union is too narrow for
    // route-name comparisons and produces false "no overlap" TS errors.
    const segs = segments as string[];
    const inAuthGroup = segs[0] === '(auth)';

    // Accept-invite owns its own multi-step state (verify link → session appears (pending) →
    // set password → accept → claims land). Leave it alone until the flow completes ('ready'),
    // otherwise the guard would yank the user to /pending the instant the link session lands.
    if (inAuthGroup && segs[1] === 'accept-invite' && status !== 'ready') return;

    if (status === 'ready') {
      // A driver with an org must be inside the app, never on the splash or an auth screen.
      if (inAuthGroup || segs[0] === '' || segs[0] === 'index') router.replace('/home');
      return;
    }

    const target =
      status === 'signedOut' ? '/sign-in' : status === 'pending' ? '/pending' : '/wrong-app';
    const currentAuthScreen = inAuthGroup ? segs[1] : undefined;
    if (currentAuthScreen !== target.slice(1)) router.replace(target);
  }, [status, segments, router]);
}

/** Data spine: NetInfo → React Query, and the outbox drain loop. Runs for the app's lifetime. */
function useDataSpine() {
  const { status } = useSession();

  useEffect(() => initConnectivity(), []);

  // Only drain while a real driver session exists — an unauthenticated sync would 401 every record
  // straight into the dead-letter list.
  useEffect(() => {
    if (status !== 'ready') return undefined;
    return initSync(queryClient);
  }, [status]);
}

function RootNavigator() {
  useProtectedRoute();
  useDataSpine();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="loads/[id]" />
      {/* Contextual work is a modal over the shell, never a tab (D51/§22.1). */}
      <Stack.Screen name="duty/check-in" options={{ presentation: 'modal' }} />
      <Stack.Screen name="drive" options={{ presentation: 'modal' }} />
      <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
      <Stack.Screen name="gallery" options={{ presentation: 'modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    HankenGrotesk_400Regular,
    HankenGrotesk_500Medium,
    HankenGrotesk_600SemiBold,
    HankenGrotesk_700Bold,
  });

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {/* Restores the persisted query cache BEFORE first paint — a cold start with no signal
            renders real cached data instead of a spinner (plan §13.2). */}
        <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
          <ThemeProvider>
            <SessionProvider>
              <RootNavigator />
            </SessionProvider>
          </ThemeProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
