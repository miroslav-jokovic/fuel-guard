import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CLOSED_PERMISSION_GRANTS,
  EDITABLE_PERMISSIONS,
  EDITABLE_ROLES,
  rolePermissionSetSchema,
  shippedPermission,
  toPermissionGrants,
  type EditablePermissionKey,
  type PermissionGrants,
  type RolePermissionRow,
  type RolePermissionSetRequest,
  type RolePermissionsResponse,
  type UserRole,
} from "@silvicom/shared";
import { requireAuth, requireRole, requireOrg } from "../../../middleware/auth.js";
import { requireFreshAuth } from "../../../middleware/requireFreshAuth.js";
import { validateBody, apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAccessCell } from "../accessWrites.js";

/**
 * Named permissions a carrier switches per role (HIRING-WORKFLOW-AUDIT-2026-10-31 §15.1, D-IDP1..4).
 *
 * `org_role_permissions` (0564) has RLS on and no policy at all, so this router is the only door:
 * the page reads through `GET /` and every change is one `write_access_cell` call (0395, given the
 * table by 0564) — the switch and its audit row in one transaction, like every other access change.
 *
 * ⚠ The API reads with the SERVICE ROLE, which bypasses RLS: every query carries its own
 * `.eq("org_id", …)`, and `rolePermissions.test.ts` asserts it with `expectOrgScoped`.
 */

const COLS = "role, permission, allowed";

/**
 * The org's grants for one request (D-IDP3) — read from the table, never from the JWT, so a switch
 * takes effect on the next request rather than the next token refresh.
 *
 * A failed read answers CLOSED (every editable role off, the admin on), not the shipped default:
 * the default includes the recruiter, so an org that switched the recruiter off would otherwise hand
 * the recruiter the very picture it refused whenever this read failed. Withheld for one request is a
 * retry; shown against the carrier's setting cannot be taken back.
 */
export async function loadPermissionGrants(admin: SupabaseClient, orgId: string): Promise<PermissionGrants> {
  const { data, error } = await admin.from("org_role_permissions").select(COLS).eq("org_id", orgId);
  if (error) return CLOSED_PERMISSION_GRANTS;
  return toPermissionGrants((data ?? []) as RolePermissionRow[]);
}

export function rolePermissionsRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  /** The org's switches and the catalogue they are read against — both, so no client rebuilds a default (D-PERM4). */
  router.get(
    "/",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const { data, error } = await admin.from("org_role_permissions").select(COLS).eq("org_id", req.auth!.orgId!);
      if (error) {
        res.status(500).json(apiError("db_error", "Could not load permissions"));
        return;
      }
      const body: RolePermissionsResponse = {
        permissions: EDITABLE_PERMISSIONS.map((p) => ({
          key: p.key,
          label: p.label,
          description: p.description,
          shippedRoles: [...p.shippedRoles],
        })),
        grants: toPermissionGrants((data ?? []) as RolePermissionRow[]),
        editableRoles: EDITABLE_ROLES,
      };
      res.json(body);
    }),
  );

  /**
   * One switch. A value equal to the shipped default — or `null` — removes the row (D-PERM4: a stored
   * default would read as a deliberate choice and stop tracking a change to the catalogue).
   */
  router.put(
    "/",
    requireOrg,
    requireRole("admin"),
    requireFreshAuth(), // SP9, Q-SET8 (a): every change on the Permissions page asks for the password again
    validateBody(rolePermissionSetSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const { role, permission, allowed } = res.locals.body as RolePermissionSetRequest;
      const key = permission as EditablePermissionKey;
      const shipped = shippedPermission(role as UserRole, key);
      const isDefault = allowed === null || allowed === shipped;

      const written = await writeAccessCell(admin, {
        table: "org_role_permissions",
        orgId,
        role,
        userId: null,
        key,
        value: isDefault ? null : String(allowed),
        actorId: req.auth!.userId,
        action: "permissions.named_changed",
        meta: { role, permission: key, allowed: isDefault ? shipped : allowed, shipped, resetToDefault: isDefault },
      });
      if (!written) {
        res.status(500).json(apiError("db_error", "Could not update permissions"));
        return;
      }
      res.json({ ok: true, role, permission: key, allowed: isDefault ? shipped : allowed, isDefault });
    }),
  );

  return router;
}
