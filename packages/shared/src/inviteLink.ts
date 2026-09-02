/**
 * Parsing the URL an invited user actually arrives on — shared by the web SPA and the driver app.
 *
 * It lived in `apps/driver/src/features/auth/acceptInvite.ts` alone until 2026-09-02, and the web
 * did not have it at all: `AcceptInvitePage.vue` relied entirely on supabase-js's
 * `detectSessionInUrl`, which handles exactly ONE of the four shapes below and treats the other
 * three as "no session". That is the whole of the invite bug — see this module's callers.
 *
 * Pure: no Supabase client, no I/O, no clock. Turning the parsed result INTO a session is each
 * app's own job, because each app holds its own client.
 *
 * ⚠ Never log a URL that reached this function. Three of the four shapes carry credentials.
 */

/**
 * The GoTrue email-link types we accept. A deliberate subset of supabase-js's `EmailOtpType`,
 * declared here rather than imported so `@silvicom/shared` keeps its zero-dependency surface
 * (its only dependency is zod). Every member is assignable to `EmailOtpType`, which is what the
 * callers pass it to.
 */
export const INVITE_LINK_TYPES = ["invite", "recovery", "magiclink", "signup"] as const;
export type InviteLinkType = (typeof INVITE_LINK_TYPES)[number];

export interface InviteLinkParams {
  /** OUR invites-table token, when the link carries one (the driver deep-link shape). */
  inviteToken: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  code: string | null;
  /** GoTrue's `token_hash` — verified with `verifyOtp`, and the only shape a mail scanner can't burn. */
  verifyTokenHash: string | null;
  verifyType: InviteLinkType | null;
  /** GoTrue's failure fragment (`error`/`error_description`), present when the link is already spent. */
  errorDescription: string | null;
}

/**
 * Decode one `application/x-www-form-urlencoded` value.
 *
 * Hand-rolled because `@silvicom/shared` compiles against `lib: ["ES2023"]` with `types: []` — no
 * DOM and no Node — so `URLSearchParams` does not exist here, and adding a lib to reach it would
 * make a platform assumption on behalf of the driver app's React Native runtime too. `+` is a space
 * in a query string but not in a path, which is why this cannot just be `decodeURIComponent`.
 */
function decodeValue(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    return raw; // a malformed escape is still worth returning verbatim rather than throwing
  }
}

/** First value wins: query params are read before the fragment, and the fragment must not overwrite. */
function collect(search: string, into: Map<string, string>): void {
  for (const pair of search.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const key = decodeValue(eq >= 0 ? pair.slice(0, eq) : pair);
    if (!key || into.has(key)) continue;
    into.set(key, eq >= 0 ? decodeValue(pair.slice(eq + 1)) : "");
  }
}

/**
 * Parse query + fragment params out of any shape an invite can arrive in:
 *
 *  1. `…/accept-invite?token_hash=…&type=invite` — what we now EMAIL. The token is verified by the
 *     page with `verifyOtp`, so a mail-security scanner's GET on the link hits our own SPA route
 *     and consumes nothing.
 *  2. `…/accept-invite#access_token=…&refresh_token=…` — the implicit-grant redirect GoTrue performs
 *     after its own `/auth/v1/verify` succeeded. Still arrives from links already in inboxes.
 *  3. `…?code=…` — the PKCE redirect shape.
 *  4. A pasted `https://…/auth/v1/verify?token=…&type=invite&redirect_to=…` action link — the rescue
 *     path when the link was copied out of the email by hand. Here `token` is a token_hash, NOT our
 *     invite token, which is why `isVerifyLink` routes it to `verifyTokenHash` instead.
 */
export function parseInviteUrl(url: string): InviteLinkParams {
  const map = new Map<string, string>();
  const [beforeHash, ...hashParts] = url.split("#");
  const hash = hashParts.join("#");
  const queryIndex = (beforeHash ?? "").indexOf("?");
  if (queryIndex >= 0) collect((beforeHash ?? "").slice(queryIndex + 1), map);
  if (hash) collect(hash, map);

  const isVerifyLink = (beforeHash ?? "").includes("/auth/v1/verify");
  let inviteToken = !isVerifyLink ? (map.get("token") ?? null) : null;

  // A pasted action link nests our invite token inside redirect_to=…?token=…
  const redirectTo = map.get("redirect_to");
  if (!inviteToken && redirectTo) {
    try {
      const decoded = decodeURIComponent(redirectTo);
      const innerQuery = decoded.indexOf("?");
      if (innerQuery >= 0) {
        const inner = new Map<string, string>();
        collect(decoded.slice(innerQuery + 1), inner);
        inviteToken = inner.get("token") ?? null;
      }
    } catch {
      /* malformed redirect_to — ignore */
    }
  }

  const rawType = map.get("type");
  const verifyType =
    rawType && (INVITE_LINK_TYPES as readonly string[]).includes(rawType)
      ? (rawType as InviteLinkType)
      : null;

  return {
    inviteToken,
    accessToken: map.get("access_token") ?? null,
    refreshToken: map.get("refresh_token") ?? null,
    code: map.get("code") ?? null,
    // Shape 1 carries `token_hash` by name; shape 4 carries the same value as `token`.
    verifyTokenHash: map.get("token_hash") ?? (isVerifyLink ? (map.get("token") ?? null) : null),
    verifyType,
    errorDescription: map.get("error_description") ?? map.get("error") ?? null,
  };
}

/** True when the URL carries anything we could turn into a session. */
export function hasSessionMaterial(p: InviteLinkParams): boolean {
  return !!((p.accessToken && p.refreshToken) ?? p.code ?? p.verifyTokenHash);
}

/**
 * The message an invited user sees when their link cannot produce a session.
 *
 * One function so the web and the driver app say the same thing, and so the distinction that
 * matters to the reader survives: "spent" is fixable by asking for a resend, "not an invite link"
 * is not. Before this, the web said neither — the router bounced them to /login and they were left
 * to guess.
 */
export function inviteLinkErrorMessage(p: InviteLinkParams): string | null {
  if (p.errorDescription)
    return "This invitation link has expired or was already used. Ask your admin to resend it.";
  if (!hasSessionMaterial(p)) return "This doesn’t look like an invitation link.";
  return null;
}
