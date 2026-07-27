import type { Request, Response, NextFunction } from "express";
import { moduleUnavailableMessage, type ModuleKey } from "@fuelguard/shared";
import { apiError } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";

/**
 * Layer 2 of the entitlement gate (D55): refuse the request before any handler runs.
 *
 * RLS is the real boundary — a disabled module's tables return zero rows even to raw PostgREST — but
 * an API that happily executes a handler and returns an empty list is a worse experience and a worse
 * log. A 403 naming the module is something a support ticket can act on.
 *
 * Reads through `org_module_enabled()` rather than a table select so the "absent row = disabled" rule
 * lives in exactly one place (the SQL function), and so a service-role caller cannot accidentally
 * bypass it by querying the table with RLS off.
 */
export function requireModule(key: ModuleKey) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const orgId = req.auth?.orgId;
    if (!orgId) {
      res.status(403).json(apiError("no_membership", "Account is not linked to an organization yet"));
      return;
    }

    const admin = getSupabaseAdmin(getAppLocals(req).env);
    void (async () => {
      try {
        const { data, error } = await admin.rpc("org_module_enabled", { p_org: orgId, p_module: key });
        if (error) {
          next(new Error(error.message));
          return;
        }
        if (data !== true) {
          res.status(403).json(apiError("module_disabled", moduleUnavailableMessage(key)));
          return;
        }
        next();
      } catch (e) {
        next(e instanceof Error ? e : new Error("Entitlement check failed"));
      }
    })();
  };
}
