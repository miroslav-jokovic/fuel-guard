import { generateVapidKeys } from "../modules/messaging/webPush.js";

/**
 * A fresh VAPID key pair for office chat's Web Push (CHAT-WEB-PUSH-PLAN WP3, `envWebPush.ts`).
 *
 *   pnpm --filter @silvicom/api exec tsx src/scripts/generateVapidKeys.ts
 *
 * Prints the two values to put in AWS Parameter Store `/silvicom/<staging|production>/api/` as SecureString —
 * a DIFFERENT pair per environment — then redeploy that environment so `fetch-settings.sh` loads them. The
 * private key is a secret: Parameter Store only, never a file, a chat or a commit. Changing a pair later
 * invalidates every device turned on with the old one (envWebPush.ts says why).
 */
const { publicKey, privateKey } = generateVapidKeys();
console.log(`WEB_PUSH_VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`WEB_PUSH_VAPID_PRIVATE_KEY=${privateKey}`);
