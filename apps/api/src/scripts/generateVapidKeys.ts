import { generateVapidKeys } from "../modules/messaging/webPush.js";

/**
 * A fresh VAPID key pair for office chat's Web Push (CHAT-WEB-PUSH-PLAN WP3, `envWebPush.ts`).
 *
 *   pnpm --filter @silvicom/api exec tsx src/scripts/generateVapidKeys.ts
 *
 * Prints the two variables to set — the SAME pair on `@fleetguard/api` and `@fleetguard/web` of one environment,
 * a DIFFERENT pair per environment. The private key is a secret: paste it into Railway, nowhere else. Changing a
 * pair later invalidates every device turned on with the old one (envWebPush.ts says why).
 */
const { publicKey, privateKey } = generateVapidKeys();
console.log(`WEB_PUSH_VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`WEB_PUSH_VAPID_PRIVATE_KEY=${privateKey}`);
