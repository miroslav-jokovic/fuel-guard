import { z } from "zod";

/**
 * A phone that proved the date of birth once is not asked for it again
 * (APPLICATION-FIX-PLAN.md U2; migration 0604).
 *
 * ── WHY ───────────────────────────────────────────────────────────────────────────────────────
 * The saved application opens to the person who types the date of birth on file (D-APP16), and it was
 * asked on every visit: for the history, and again for the signing. The gate exists for a link that is
 * forwarded, scanned by a mail gateway or opened somewhere else — none of which is the driver's own
 * phone on its second visit. So a right answer can leave a random token on the device, and the next
 * visit on that device sends the token instead of asking.
 *
 * ⚠ **The token is a second thing to hold, never a way in by itself.** It is checked only on a link
 * that resolves, it is salted by the invitation, and the server keeps its hash. A link without it is
 * asked the date of birth exactly as before.
 *
 * ⚠ **Only where the driver says so, and never on a computer.** The page offers it on a phone and
 * leaves it out on a desktop: an office computer is where a link is opened for somebody else
 * (the desktop hand-off), and its history holds the link.
 */

/** How long a device is remembered. The link's own expiry still applies first. */
export const TRUSTED_DEVICE_TTL_DAYS = 30;
/** Live devices one application keeps: a phone, a second phone, a tablet — and a bound on the table. */
export const TRUSTED_DEVICE_MAX = 5;

/** Which right answer made the device remembered; 0604's CHECK holds the same two. */
export const TRUSTED_DEVICE_EARNED_BY = ["date_of_birth", "code"] as const;
export type TrustedDeviceEarnedBy = (typeof TRUSTED_DEVICE_EARNED_BY)[number];

/** 32 random bytes, base64url: 43 characters. */
export const DEVICE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** `POST /api/public/application/:token/unlock-device` — the token this device was given. */
export const unlockDeviceSchema = z
  .object({ device_token: z.string().regex(DEVICE_TOKEN_PATTERN, "Not a device token") })
  .strict();
export type UnlockDevice = z.infer<typeof unlockDeviceSchema>;
