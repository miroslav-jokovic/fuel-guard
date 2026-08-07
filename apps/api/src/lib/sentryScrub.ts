/**
 * PII scrubbing for Sentry events — canonical implementation now lives in @fuelguard/shared
 * (`sentryScrub.ts`) so the API and the driver app share ONE scrubber (hardening plan Phase 8.1):
 * a PII pattern added for one surface must protect both. This shim preserves the historical import
 * path (`instrument.ts`, tests) — see the shared module for the rules and rationale.
 */
export {
  keyIsPii,
  scrubObject,
  scrubSentryEvent,
  scrubString,
  type ScrubbableEvent,
} from "@fuelguard/shared";
