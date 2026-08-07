import "../global.css";
import { useEffect } from "react";
import { useFonts } from "expo-font";
import {
  HankenGrotesk_400Regular,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
  HankenGrotesk_700Bold,
} from "@expo-google-fonts/hanken-grotesk";
import { Stack, useRouter, useSegments } from "expo-router";
import Constants from "expo-constants";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { isVersionBelow } from "@fuelguard/shared";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { SessionProvider, useSession } from "@/session/SessionProvider";
import { useFeatures } from "@/session/useFeatures";
import { UpdateRequired } from "@/components/UpdateRequired";
import { queryClient } from "@/lib/queryClient";
import { persistOptions } from "@/lib/persist";
import { initConnectivity } from "@/lib/connectivity";
import { initSync } from "@/data/sync";
import { registerSyncHandlers } from "@/data/handlers";
import { configureForegroundHandler, onNotificationTap, registerForPush } from "@/features/notifications/push";
import { resolveDeepLink } from "@/features/notifications/deepLink";
import { initCrashReporting, setCrashUser } from "@/lib/crash";

// Crash reporting FIRST (Phase 8.1) — a crash in any later module-load step should be captured.
// No-op without EXPO_PUBLIC_SENTRY_DSN; PII-scrubbed by the shared scrubber either way.
initCrashReporting();
// Register outbox handlers once, at module load, so a queued record can always find its handler —
// even if the engine starts before the feature screen that enqueues it has ever mounted.
registerSyncHandlers();
// Foreground push presentation, likewise once at module load (Phase 6).
configureForegroundHandler();

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
    if (status === "loading") return;
    // Cast to plain string[] — expo-router's inferred literal union is too narrow for
    // route-name comparisons and produces false "no overlap" TS errors.
    const segs = segments as string[];
    const inAuthGroup = segs[0] === "(auth)";

    // Accept-invite owns its own multi-step state (verify link → session appears (pending) →
    // set password → accept → claims land). Leave it alone until the flow completes ('ready'),
    // otherwise the guard would yank the user to /pending the instant the link session lands.
    if (inAuthGroup && segs[1] === "accept-invite" && status !== "ready") return;

    if (status === "ready") {
      // A driver with an org must be inside the app, never on the splash or an auth screen. At the
      // root path "/" (the splash, app/index.tsx) expo-router yields an EMPTY segments array — so
      // segs[0] is `undefined`, NOT '' or 'index'. The old check compared against '' / 'index' and
      // therefore never matched the splash, stranding a fully-ready driver on the spinner (it never
      // called replace('/home')). Treat "no segments" as the splash too.
      const onSplashOrAuth = inAuthGroup || segs.length === 0 || segs[0] === "index";
      if (onSplashOrAuth) router.replace("/home");
      return;
    }

    const target =
      status === "signedOut" ? "/sign-in" : status === "pending" ? "/pending" : "/wrong-app";
    const currentAuthScreen = inAuthGroup ? segs[1] : undefined;
    if (currentAuthScreen !== target.slice(1)) router.replace(target);
  }, [status, segments, router]);
}

/** Data spine: NetInfo → React Query, and the outbox drain loop. Runs for the app's lifetime. */
function useDataSpine() {
  const { status, userId } = useSession();

  useEffect(() => initConnectivity(), []);

  // Crash triage context: the login id and NOTHING else (the scrubber enforces it). Cleared on
  // sign-out so a shared cab device never attributes the next driver's crash to the last one.
  useEffect(() => {
    setCrashUser(status === "ready" ? userId : null);
  }, [status, userId]);

  // Only drain while a real driver session exists — an unauthenticated sync would 401 every record
  // straight into the dead-letter list.
  useEffect(() => {
    if (status !== "ready") return undefined;
    return initSync(queryClient);
  }, [status]);
}

/**
 * Push lifecycle (Phase 6 / D53): register this device once a real session exists AND the org has
 * the notifications feature; wire tap → the exact screen the notification is about. Every failure
 * mode degrades to the in-app centre — nothing here can break the app.
 */
function usePushNotifications() {
  const { status } = useSession();
  const { enabled, isLoaded } = useFeatures();
  const router = useRouter();
  const notificationsEnabled = isLoaded && enabled("notifications");

  useEffect(() => {
    if (status !== "ready" || !notificationsEnabled) return;
    void registerForPush();
  }, [status, notificationsEnabled]);

  useEffect(() => {
    if (status !== "ready") return undefined;
    // Server deep links are translated to APP routes (resolveDeepLink) — never trusted raw.
    return onNotificationTap((link) => router.push(resolveDeepLink(link)));
  }, [status, router]);
}

function RootNavigator() {
  useProtectedRoute();
  useDataSpine();
  usePushNotifications();
  const { minAppVersion } = useFeatures();

  // Force-upgrade gate (4.6): the org's `core.app` minVersion vs this build. Rendered INSTEAD of
  // the navigator so no stale surface is reachable underneath. isVersionBelow fails OPEN on any
  // malformed value — a dashboard typo can never brick a fleet — and the outbox is untouched, so
  // queued work survives the update.
  const appVersion = Constants.expoConfig?.version ?? null;
  if (minAppVersion && isVersionBelow(appVersion, minAppVersion)) {
    return <UpdateRequired minVersion={minAppVersion} />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="loads/[id]" />
      {/* Contextual work is a modal over the shell, never a tab (D51/§22.1). */}
      <Stack.Screen name="duty/check-in" options={{ presentation: "modal" }} />
      <Stack.Screen name="drive" options={{ presentation: "modal" }} />
      <Stack.Screen name="settings" options={{ presentation: "modal" }} />
      <Stack.Screen name="gallery" options={{ presentation: "modal" }} />
      {/* Hazmat hub + capture + verdict (hardening plan Phase 3) — same modal contract as the
          other contextual surfaces; entry lives in More, gated on the hazmatguard entitlement. */}
      <Stack.Screen name="hazmat/index" options={{ presentation: "modal" }} />
      <Stack.Screen name="hazmat/capture" options={{ presentation: "modal" }} />
      <Stack.Screen name="hazmat/[loadId]" options={{ presentation: "modal" }} />
      {/* Notification centre (Phase 6) — opened from the Home bell, gated on `notifications`. */}
      <Stack.Screen name="notifications" options={{ presentation: "modal" }} />
      {/* Messages (Phase 7) — inbox + conversation, gated on `messages`. */}
      <Stack.Screen name="messages/index" options={{ presentation: "modal" }} />
      <Stack.Screen name="messages/[id]" options={{ presentation: "modal" }} />
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
