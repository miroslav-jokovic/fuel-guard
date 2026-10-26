import type { Request, Response, NextFunction } from "express";
import { moduleUnavailableMessage, type ModuleKey } from "@silvicom/shared";
import { apiError } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { createTtlCache } from "../lib/ttlCache.js";

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
 *
 * The answer is cached for 15 s per (org, module), the life `membershipCurrent.ts` chose (SP7): it was
 * one PostgREST call on EVERY request, and the uat load test (Q-CHAT14, 2026-10-23) found those calls
 * were what capped the API. Entitlements are written by `admin-api`, another service, so nothing here
 * can forget them on a write. A plan change therefore reaches the API within 15 s, and RLS refuses the
 * tables from the moment it commits. A failed read is not cached (lib/ttlCache.ts).
 */
export const MODULE_CACHE_MS = 15_000;
const entitlements = createTtlCache<boolean>(MODULE_CACHE_MS);

async function moduleEnabled(admin: ReturnType<typeof getSupabaseAdmin>, orgId: string, key: ModuleKey): Promise<boolean> {
  return entitlements.get(`${orgId}:${key}`, async () => {
    const { data, error } = await admin.rpc("org_module_enabled", { p_org: orgId, p_module: key });
    if (error) throw new Error(error.message);
    return data === true;
  });
}
export function requireModule(key: ModuleKey) {
  const handler = (req: Request, res: Response, next: NextFunction): void => {
    const orgId = req.auth?.orgId;
    if (!orgId) {
      res.status(403).json(apiError("no_membership", "Account is not linked to an organization yet"));
      return;
    }

    const admin = getSupabaseAdmin(getAppLocals(req).env);
    void (async () => {
      try {
        if (!(await moduleEnabled(admin, orgId, key))) {
          res.status(403).json(apiError("module_disabled", moduleUnavailableMessage(key)));
          return;
        }
        next();
      } catch (e) {
        next(e instanceof Error ? e : new Error("Entitlement check failed"));
      }
    })();
  };
  // Runtime marker for routeGates.test.ts (P4.2, D-SEP10).
  return Object.assign(handler, { gateKind: "module" as const });
}
