import { getClient, lastEventId } from "@sentry/vue";

/**
 * The handle a reader quotes back when something failed (Q-UI1, UI-GAPS-PLAN.md §6).
 *
 * ── Why this is not simply `captureException(err)` ──────────────────────────────────────────────
 * Measured on @sentry/vue 10.69.0, 2026-08-25: with no `Sentry.init` — which is the state whenever
 * `VITE_SENTRY_DSN` is unset, so every dev and preview build — `captureException()` STILL returns a
 * plausible 32-hex event id, for an event that went nowhere. `lastEventId()` is honest and returns
 * undefined. A reference built from the former would have a carrier reading out a convincing
 * identifier that matches nothing in Sentry, which is worse than no identifier at all: it looks
 * authoritative and it costs somebody a search.
 *
 * So the id is taken from `lastEventId()` and only when a client actually exists. When it does not,
 * the reference falls back to what is certainly true and certainly useful to whoever reads the
 * logs — when, and where.
 */
export function errorReference(parts: {
  /** When it failed, ISO-8601. Passed in rather than read here, so this stays pure and testable. */
  at: string;
  /** The path the reader was on. */
  path?: string | null;
  /** Overrides the Sentry lookup. Tests pass this; application code should not. */
  eventId?: string | null;
}): string {
  const id = parts.eventId !== undefined ? parts.eventId : sentryEventId();
  return [parts.at, parts.path, id].filter(Boolean).join("  ·  ");
}

/**
 * The current Sentry event id, or null when nothing was reported.
 *
 * `getClient()` is the gate rather than a try/catch: it returns undefined until `Sentry.init` runs,
 * and `lastEventId()` is only meaningful after an event has actually been sent by a live client.
 */
export function sentryEventId(): string | null {
  if (!getClient()) return null;
  return lastEventId() ?? null;
}
