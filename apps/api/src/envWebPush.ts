import { z } from "zod";

/**
 * Office chat on the phone — Web Push (`docs/plans/messaging/CHAT-WEB-PUSH-PLAN.md`, D-WP7), split out of
 * `env.ts` on the `envUnitFiles.ts` precedent. Spread into the one schema, so a deployment still gets one parse.
 *
 * The VAPID key pair (RFC 8292) is this server's identity to the browsers' push services: a browser subscribes
 * with the PUBLIC key, and every push is signed with the PRIVATE one. All three unset = push is off and the web
 * offers only CH6d's in-tab desktop alerts — the state of every deployment until the owner sets them (WP3).
 *
 * ⚠ CHANGING THE PAIR INVALIDATES EVERY SUBSCRIPTION. A push service refuses a message signed by a key other
 * than the one the browser subscribed with, so after a rotation every person turns notifications on again on
 * each device. Generate a pair with `pnpm --filter @silvicom/api exec tsx src/scripts/generateVapidKeys.ts`;
 * set the same pair on `@fleetguard/api` AND `@fleetguard/web` (both run this API; docs/DEPLOYMENT.md), and a
 * different pair per environment.
 */
const base64url = (bytes: number) =>
  z.string().trim().regex(/^[A-Za-z0-9_-]+$/, "base64url, no padding")
    .refine((s) => Buffer.from(s, "base64url").length === bytes, `must decode to ${bytes} bytes`);

export const webPushEnvFields = {
  /** Uncompressed P-256 public key, 65 bytes, base64url. */
  WEB_PUSH_VAPID_PUBLIC_KEY: base64url(65).optional(),
  /** The matching private scalar, 32 bytes, base64url. Secret. */
  WEB_PUSH_VAPID_PRIVATE_KEY: base64url(32).optional(),
  /**
   * Who to contact about this sender (RFC 8292 `sub`): `mailto:` or an `https:` URL. Apple refuses a push
   * whose subject is neither. Unset: the web app's own URL (`WEB_APP_URL`), which is https in every deployment.
   */
  WEB_PUSH_SUBJECT: z.string().trim().regex(/^(mailto:\S+@\S+|https:\/\/\S+)$/, "mailto: or https:").optional(),
};
