/**
 * The words a driver reads when a request fails (Visual 2026 D-DV26, Q-DV8 g).
 *
 * Before this, `apiFetch` fell back to `HTTP ${status}` whenever the server sent no envelope, and it
 * passed every server message through verbatim. The V9 critiques (2026-11-22) saw "HTTP 404" in a
 * driver's banner; the API's own messages are no better for a driver — a 500 reads "Could not load
 * … (ref: 3f9a1c2b)" (`dbErrorResponse`, written for an operator to grep) and a 400 carries a Zod
 * issue ("Expected string, received null"). Each of those lands in a banner, a toast, or the
 * failed-sync list's subtitle.
 *
 * The rule: the server's words survive only for a DOMAIN refusal — a 403, 409 or 422 with its own
 * code, where the route wrote the sentence for the person asking ("This stop is already complete",
 * the device-limit message). Everything else becomes a sentence chosen by status. The technical
 * part is kept in `detail`, for Sentry and the build card, never for the banner.
 *
 * Pure on purpose: `api.ts` imports Supabase and the device key, so the wording is tested here.
 */

export interface DriverError {
  code: string;
  message: string;
  /** "HTTP 500 · db_error · Could not load … (ref: 3f9a1c2b)". Never shown in a banner. */
  detail?: string;
}

export const ERROR_WORDS = {
  network: "No connection. Anything you entered is saved and will send when you're back online.",
  timeout: 'The connection is too slow right now. Anything you entered is saved and will send.',
  signedOut: "You've been signed out. Sign in again.",
  forbidden: "Your account can't do this. Ask the office.",
  notFound: 'This was changed by the office. Pull down to refresh.',
  conflict: 'Someone else already updated this. Pull down to refresh.',
  invalid: "Something in this entry wasn't accepted. Check it and try again.",
  busy: 'Our server is busy. Trying again in a minute.',
  unexpected: "Something went wrong on our side. We'll try again.",
} as const;

/** Codes that name no domain fact: the server's text under them is an operator's, not a driver's. */
const GENERIC_CODES = new Set(['error', 'db_error', 'internal', 'internal_error', 'invalid_request', 'bad_response']);

/** Statuses at which a route refuses a driver on purpose and says why in its own words. */
const DOMAIN_REFUSALS = new Set([403, 409, 422]);

function byStatus(status: number): string {
  if (status === 401) return ERROR_WORDS.signedOut;
  if (status === 403) return ERROR_WORDS.forbidden;
  if (status === 404 || status === 410) return ERROR_WORDS.notFound;
  if (status === 409) return ERROR_WORDS.conflict;
  if (status === 400 || status === 422) return ERROR_WORDS.invalid;
  if (status === 408 || status === 429 || status >= 500) return ERROR_WORDS.busy;
  return ERROR_WORDS.unexpected;
}

/**
 * The driver's sentence for a failed response. `server` is the API's `{ code, message }` envelope
 * when it sent one.
 */
export function driverError(status: number, server?: { code?: string; message?: string } | null): DriverError {
  // An envelope with an empty code is the generic case too, which `??` alone would not catch.
  let code = server?.code ?? '';
  if (code === '') code = 'error';
  const serverMessage = server?.message?.trim();
  const detail = [`HTTP ${status}`, server?.code, serverMessage].filter(Boolean).join(' · ');

  if (serverMessage && DOMAIN_REFUSALS.has(status) && !GENERIC_CODES.has(code)) {
    return { code, message: serverMessage, detail };
  }
  return { code, message: byStatus(status), detail };
}
