import type { Application, Request } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";
import type { PlatformToken } from "./auth.js";
import type { PlatformAdmin } from "./platformAdmins.js";

/** Typed view of app.locals. verifyToken / lookupPlatformAdmin are injectable so tests avoid real JWKS + DB. */
export interface AppLocals {
  env: Env;
  verifyToken?: (token: string) => Promise<PlatformToken>;
  lookupPlatformAdmin?: (identity: { userId: string; email: string | null }) => Promise<PlatformAdmin | null>;
  /** Injected service-role client for tests; production resolves the real one lazily. */
  supabaseAdmin?: SupabaseClient;
}

export function setAppLocals(app: Application, locals: Partial<AppLocals>): void {
  Object.assign(app.locals, locals);
}

export function getAppLocals(req: Request): AppLocals {
  return req.app.locals as AppLocals;
}
