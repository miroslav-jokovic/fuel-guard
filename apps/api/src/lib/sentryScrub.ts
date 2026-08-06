/**
 * PII scrubbing for Sentry error events (§13.4). This product handles date of birth, home address, CDL
 * number, and medical-registry number — none of it may reach Sentry — plus BOL image bytes, which must
 * never appear in a breadcrumb or context. Pure + unit-tested; `instrument.ts` wires it into `beforeSend`.
 *
 * Two layers: (1) key-based — any object key that names PII has its value redacted wherever it appears;
 * (2) value-based — base64 image blobs and long digit runs (CDL / medical-registry / DOB-like) are
 * redacted inside free-text strings (e.g. an error message that interpolated a licence number).
 */

const REDACTED = "[redacted]";

/** Object keys whose VALUES are PII → redacted (case-insensitive substring match). */
const PII_KEY_PATTERNS: RegExp[] = [
  /cdl/i,
  /licen[sc]e/i,
  /\bdob\b|date.?of.?birth|birth.?date/i,
  /\bssn\b|social.?security/i,
  /address|street|zip|postal/i,
  /medical.?registry|med.?cert|registry.?number|medical.?examiner/i,
  /passport/i,
  /\bphone\b|mobile/i,
  /\bemail\b/i,
];

export function keyIsPii(key: string): boolean {
  return PII_KEY_PATTERNS.some((re) => re.test(key));
}

/** Redact PII-shaped substrings inside a free-text value (images, long id/number runs). */
export function scrubString(s: string): string {
  return s
    .replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/gi, "[redacted-image]")
    .replace(/\b\d{7,}\b/g, "[redacted-number]"); // CDL / medical-registry / long numeric PII
}

function scrubValue(v: unknown, redactWhole: boolean): unknown {
  if (redactWhole) return v === undefined ? undefined : REDACTED;
  if (typeof v === "string") return scrubString(v);
  if (Array.isArray(v)) return v.map((x) => scrubValue(x, false));
  if (v && typeof v === "object") return scrubObject(v as Record<string, unknown>);
  return v;
}

export function scrubObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = scrubValue(v, keyIsPii(k));
  return out;
}

/** The subset of a Sentry event we touch. Loosely typed so the scrubber stays Sentry-version-agnostic. */
export interface ScrubbableEvent {
  message?: unknown;
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  request?: { data?: unknown; headers?: Record<string, unknown>; cookies?: unknown; query_string?: unknown };
  breadcrumbs?: Array<{ message?: unknown; data?: Record<string, unknown> } & Record<string, unknown>>;
  user?: Record<string, unknown>;
  [k: string]: unknown;
}

/**
 * Scrub a Sentry event in place-ish (returns the same object). Keeps `user.id` (the actor we set
 * explicitly) but drops every other user field; strips request bodies/cookies; redacts PII across
 * extra/contexts/breadcrumbs. Safe to pass any event shape.
 */
export function scrubSentryEvent(event: ScrubbableEvent): ScrubbableEvent {
  if (typeof event.message === "string") event.message = scrubString(event.message);
  if (event.extra) event.extra = scrubObject(event.extra);
  if (event.contexts) event.contexts = scrubObject(event.contexts);

  if (event.request) {
    // Request bodies + cookies can carry credentials/PII and image bytes — drop them entirely.
    delete event.request.data;
    delete event.request.cookies;
    if (event.request.headers) event.request.headers = scrubObject(event.request.headers);
  }

  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = event.breadcrumbs.map((b) => ({
      ...b,
      ...(typeof b.message === "string" ? { message: scrubString(b.message) } : {}),
      ...(b.data ? { data: scrubObject(b.data) } : {}),
    }));
  }

  if (event.user) {
    const id = event.user.id;
    event.user = id === undefined ? {} : { id };
  }

  return event;
}
