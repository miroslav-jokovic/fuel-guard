import * as Sentry from "@sentry/node";

/**
 * Sentry error monitoring. Initialised BEFORE the app and its instrumented libraries load, so this
 * file is imported first in index.ts. Entirely a no-op unless SENTRY_DSN is set — local, dev, test
 * and CI runs are unaffected. Reads process.env directly because it runs before the validated env is
 * loaded; the same vars are declared in env.ts for documentation + typing.
 */
const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    // Errors-only by default (0); raise SENTRY_TRACES_SAMPLE_RATE to sample performance traces.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
    // We attach org_id / user id explicitly in the auth middleware; never auto-collect IP/cookies/PII.
    sendDefaultPii: false,
  });
}
