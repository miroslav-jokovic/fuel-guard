import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { scrubSentryEvent, type ScrubbableEvent } from '@fuelguard/shared';
import { env } from './env';

/**
 * Crash reporting for the driver app (hardening plan Phase 8.1). An enterprise fleet app without
 * crash telemetry is flying blind — a driver in a cab does not file bug reports.
 *
 * Mirrors the API's posture exactly, via the SAME shared scrubber (`@fuelguard/shared`
 * sentryScrub): never auto-collect PII, keep only user.id, strip CDL/DOB/address/registry numbers
 * and image bytes before anything leaves the device. Entirely a no-op unless
 * EXPO_PUBLIC_SENTRY_DSN is set — dev and test runs are unaffected.
 *
 * SCOPE (deliberate, documented): this is the JS-layer init, which captures the dominant failure
 * class in an RN app (unhandled JS errors, promise rejections). Native crash capture + sourcemap
 * upload additionally need the `@sentry/react-native/expo` config plugin with org/project +
 * SENTRY_AUTH_TOKEN at build time — an EAS/owner step, tracked in the build-status doc, NOT
 * assumed here (an unconfigured plugin must never be able to break `expo prebuild`).
 */
export function initCrashReporting(): void {
  const dsn = env.sentryDsn;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: __DEV__ ? 'development' : 'production',
    sendDefaultPii: false,
    tracesSampleRate: 0, // errors-only; raise deliberately if perf tracing is ever wanted
    release: `fuelguard-driver@${Constants.expoConfig?.version ?? 'unknown'}`,
    beforeSend: (event) => scrubSentryEvent(event as unknown as ScrubbableEvent) as unknown as typeof event,
    beforeBreadcrumb: (crumb) => {
      // Network breadcrumbs can carry full URLs with ids; keep the category, scrub the rest.
      if (crumb.data) crumb.data = scrubSentryEvent({ extra: crumb.data }).extra ?? {};
      return crumb;
    },
  });
}

/** Attach the signed-in login id (and ONLY the id — the scrubber enforces it) for triage. */
export function setCrashUser(userId: string | null): void {
  if (!env.sentryDsn) return;
  Sentry.setUser(userId ? { id: userId } : null);
}
