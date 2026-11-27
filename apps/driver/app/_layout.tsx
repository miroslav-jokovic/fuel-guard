import "../global.css";
import { useEffect } from "react";
import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments } from "expo-router";
import Constants from "expo-constants";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { isVersionBelow } from "@silvicom/shared";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { DISPLAY_FACE, DISPLAY_FACE_BOLD } from "@/theme/typography";
import { ICON_FACE, ICON_FACE_FILL } from "@/theme/iconFont";
import { SessionProvider, useSession } from "@/session/SessionProvider";
import { useFeatures } from "@/session/useFeatures";
import { UpdateRequired } from "@/components/UpdateRequired";
import { ToastProvider } from "@/components/ToastHost";
import { queryClient } from "@/lib/queryClient";
import { persistOptions } from "@/lib/persist";
import { initConnectivity } from "@/lib/connectivity";
import { initSync } from "@/data/sync";
import { registerSyncHandlers } from "@/data/handlers";
import { configureForegroundHandler, onNotificationTap, registerForPush } from "@/features/notifications/push";
import { resolveDeepLink } from "@/features/notifications/deepLink";
import { initCrashReporting, setCrashUser } from "@/lib/crash";
import { useDeviceLimited } from "@/lib/deviceLimit";

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
  // A fourth device (IA-S6): the API refuses this phone until another device is signed out.
  const deviceLimited = useDeviceLimited();
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

    if (status === "ready" && deviceLimited) {
      if (segs[0] !== "device-limit") router.replace("/device-limit");
      return;
    }
    if (status === "ready" && segs[0] === "device-limit") {
      router.replace("/home");
      return;
    }

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
  }, [status, deviceLimited, segments, router]);
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
      {/* Score and Navigate were hidden JS tabs until V3; a hidden native tab cannot be reached, so
          they are pushed screens here and keep their URLs (/score from More, Home and a
          notification; /navigate is the dev-only nav seam, D52). */}
      <Stack.Screen name="score" />
      <Stack.Screen name="navigate" options={{ presentation: "modal" }} />
      {/* Contextual work is a modal over the shell, never a tab (D51/§22.1). */}
      <Stack.Screen name="duty/check-in" options={{ presentation: "modal" }} />
      <Stack.Screen name="drive" options={{ presentation: "modal" }} />
      <Stack.Screen name="settings" options={{ presentation: "modal" }} />
      <Stack.Screen name="scanner-settings" options={{ presentation: "modal" }} />
      <Stack.Screen name="gallery" options={{ presentation: "modal" }} />
      {/* Hazmat capture + verdict (hardening plan Phase 3) — same modal contract as the other
          contextual surfaces. The hub itself is the Documents TAB since D-DB14. */}
      <Stack.Screen name="hazmat/capture" options={{ presentation: "modal" }} />
      {/* The scanner (D-LED6): full screen, and no swipe-down — a driver steadying a page must not
          dismiss it by accident. Close is its own button. */}
      <Stack.Screen name="scan" options={{ presentation: "fullScreenModal", gestureEnabled: false }} />
      <Stack.Screen name="hazmat/[loadId]" options={{ presentation: "modal" }} />
      {/* Notification centre (Phase 6) — opened from the Home bell, gated on `notifications`. */}
      <Stack.Screen name="notifications" options={{ presentation: "modal" }} />
      {/* Notification switches (Q-DF-7, 2026-11-23) — opened from More › Settings. */}
      <Stack.Screen name="notification-settings" options={{ presentation: "modal" }} />
      {/* Messages (Phase 7) — inbox + conversation, gated on `messages`. */}
      <Stack.Screen name="messages/index" options={{ presentation: "modal" }} />
      <Stack.Screen name="messages/[id]" options={{ presentation: "modal" }} />
    </Stack>
  );
}

export default function RootLayout() {
  // Visual 2026 D-DV8: text is the platform face, which needs no loading. Only the carrier's display
  // face is bundled — the two static cuts of Big Shoulders Display, instanced from Google Fonts' OFL
  // variable font (provenance in src/theme/typography.ts). Keyed by the names typography.ts uses, so
  // the family a style asks for and the family loaded here cannot differ.
  const [fontsLoaded] = useFonts({
    [DISPLAY_FACE]: require("../assets/fonts/BigShouldersDisplay-ExtraBold.ttf") as number,
    [DISPLAY_FACE_BOLD]: require("../assets/fonts/BigShouldersDisplay-Black.ttf") as number,
    // The icon glyphs (V8, src/theme/iconFont.ts): Material Symbols subset to the app's names.
    [ICON_FACE]: require("../assets/fonts/MaterialSymbolsRounded.ttf") as number,
    [ICON_FACE_FILL]: require("../assets/fonts/MaterialSymbolsRoundedFill.ttf") as number,
  });

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {/* Restores the persisted query cache BEFORE first paint — a cold start with no signal
            renders real cached data instead of a spinner (plan §13.2). */}
        <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
          <ThemeProvider>
            {/* Inside ThemeProvider so a toast reads the same theme variables as the screen that
                raised it, and outside the navigator so it outlives a router.back(). */}
            <ToastProvider>
              <SessionProvider>
                <RootNavigator />
              </SessionProvider>
            </ToastProvider>
          </ThemeProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
