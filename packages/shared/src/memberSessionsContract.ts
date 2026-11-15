import { z } from "zod";
import { deviceLabel } from "./deviceLabel.js";
import { recordId } from "./recordId.js";

/**
 * Signed-in devices (INSTALLED-APP-PLAN IA-S3; Q-IA3 (b), the owner's ruling of 2026-11-15; migration 0615).
 *
 * One entry per SIGN-IN that has not been signed out of — Supabase's session — so a phone, a PC and a browser
 * profile nobody has opened since March are three. A person sees and ends their own; an admin, anybody's in
 * their company. What is shown is what tells devices apart and nothing of a token.
 */
export const memberSessionSchema = z.object({
  id: recordId(),
  /** "Chrome on Windows" — `sessionDeviceLabel` of the user agent recorded at sign-in. */
  device: z.string(),
  created_at: z.string(),
  last_used_at: z.string(),
  /** The address it was last used from, as recorded; null when there is none. */
  ip: z.string().nullable(),
  /** The session this very request is signed in with. It is never ended from this list: that is Sign out. */
  current: z.boolean(),
});
export type MemberSession = z.infer<typeof memberSessionSchema>;

export const memberSessionsResponseSchema = z.object({ sessions: z.array(memberSessionSchema) });
export type MemberSessionsResponse = z.infer<typeof memberSessionsResponseSchema>;

/**
 * A session's device, from the user agent the auth server recorded. A browser reads as `deviceLabel` reads it.
 * What is not a browser — the driver app signs in through a native HTTP client — keeps its own first product
 * token ("okhttp/4.12.0"), because "Browser on this device" on a list of somebody ELSE'S devices names nothing.
 */
export function sessionDeviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent?.trim();
  if (!ua) return "Unknown device";
  const label = deviceLabel(ua);
  if (!label.startsWith("Browser on ")) return label;
  const product = ua.split(/\s+/)[0]!.slice(0, 60);
  const os = label.slice("Browser on ".length);
  return os === "this device" ? product : `${product} on ${os}`;
}
