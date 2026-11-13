import type { NextFunction, Request, Response } from "express";
import {
  callerPermissions,
  effectivePermission,
  type CallerPermissions,
  type EditablePermissionKey,
  type UserRole,
} from "@silvicom/shared";
import { apiError } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../lib/appLocals.js";
import { loadPermissionGrants } from "./routes/rolePermissions.js";

/**
 * A route gate on a NAMED permission (HIRING-WORKFLOW-AUDIT-2026-10-31 §15.1, 0564) — the carrier's
 * per-role switch, read from `org_role_permissions` on every request (D-IDP3), never from the token, so
 * a change on Settings → Permissions applies to the next request rather than the next sign-in.
 *
 * The first two readers asked the switch inside a service (`canSeePaperImage`), because a picture is
 * WITHHELD rather than the request refused. "Close an application" refuses the act itself, so it is a
 * gate in front of the route like `requireSection`, and marks itself one (`gateKind`) so the route
 * ledger sees it.
 *
 * ⚠ A failed read answers CLOSED (`loadPermissionGrants`): every editable role off, the admin on. A
 * refused close is a retry; a close the carrier had switched off cannot be taken back.
 */
export function requireNamedPermission(key: EditablePermissionKey) {
  const handler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const role = (req.auth?.role ?? null) as UserRole | null;
    const orgId = req.auth?.orgId ?? null;
    let allowed = false;
    if (orgId) {
      try {
        const grants = await loadPermissionGrants(getSupabaseAdmin(getAppLocals(req).env), orgId);
        allowed = effectivePermission(role, key, grants);
      } catch {
        allowed = role === "admin";
      }
    }
    if (!allowed) {
      res.status(403).json(apiError("forbidden", "Your role cannot do this. An administrator can change that in Settings → Permissions."));
      return;
    }
    next();
  };
  return Object.assign(handler, { gateKind: "role" as const, permission: key });
}

/**
 * The same question as `requireNamedPermission`, as a boolean, for a route that serves the holder and
 * the non-holder differently instead of refusing one: a unit note's author edits their own note either
 * way, and the `notes.manage_all` holder may edit anybody's (UNIT-NOTES-PLAN D-UN19) — `holdsSurface`'s
 * shape for chat's team acts. Closed on a failed read, the admin still on.
 */
export async function holdsNamedPermission(req: Request, key: EditablePermissionKey): Promise<boolean> {
  const role = (req.auth?.role ?? null) as UserRole | null;
  const orgId = req.auth?.orgId ?? null;
  if (!orgId) return false;
  try {
    return effectivePermission(role, key, await loadPermissionGrants(getSupabaseAdmin(getAppLocals(req).env), orgId));
  } catch {
    return role === "admin";
  }
}

/**
 * Every named permission for the caller, for `/api/me` — the screens hide what the gate above would
 * refuse, asked of the same resolver. Closed on any failure (the admin still holds everything): this
 * runs on the identity bootstrap, so it must never throw.
 */
export async function callerNamedPermissions(
  req: Request,
  orgId: string | null,
  role: UserRole | null,
): Promise<CallerPermissions> {
  if (!orgId) return callerPermissions(null, {});
  try {
    return callerPermissions(role, await loadPermissionGrants(getSupabaseAdmin(getAppLocals(req).env), orgId));
  } catch {
    return callerPermissions(role === "admin" ? role : null, {});
  }
}
