import type { Application, Request } from "express";
import type { AuthContext } from "@fuelguard/shared";
import type { Env } from "../env.js";

/** Typed view of app.locals (env + optional test verifier). */
export interface AppLocals {
  env: Env;
  verifyToken?: (token: string) => Promise<AuthContext>;
}

export function setAppLocals(app: Application, locals: AppLocals): void {
  Object.assign(app.locals, locals);
}

export function getAppLocals(req: Request): AppLocals {
  return req.app.locals as AppLocals;
}
