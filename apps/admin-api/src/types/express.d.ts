import type { PlatformToken } from "../lib/auth.js";
import type { PlatformAdmin } from "../lib/platformAdmins.js";

declare global {
  namespace Express {
    interface Request {
      /** Set by requirePlatformAuth after verifying the Supabase JWT (identity only). */
      platformToken?: PlatformToken;
      /** Set by requirePlatformAdmin after the allowlist lookup (authorized principal). */
      platform?: PlatformAdmin;
    }
  }
}

export {};
