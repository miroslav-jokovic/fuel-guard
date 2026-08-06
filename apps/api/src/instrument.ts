import * as Sentry from "@sentry/node";
import { ENGINE_VERSION } from "@hazmat/engine";
import { LATEST_DATASET_VERSION } from "@hazmat/data";
import { PLACARD_ART_VERSION } from "@hazmat/placards";
import { scrubSentryEvent, type ScrubbableEvent } from "./lib/sentryScrub.js";

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
    // §13.4: an error is traceable to the exact regulatory inputs it was produced under.
    release: `hazmat@engine-${ENGINE_VERSION}+data-${LATEST_DATASET_VERSION}+art-${PLACARD_ART_VERSION}`,
    // §13.4: strip DOB / home address / CDL / medical-registry numbers + image bytes before anything leaves.
    beforeSend: (event) => scrubSentryEvent(event as unknown as ScrubbableEvent) as unknown as typeof event,
  });
}
