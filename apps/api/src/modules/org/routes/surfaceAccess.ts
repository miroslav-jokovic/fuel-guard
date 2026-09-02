import { Router } from "express";
import {
  EDITABLE_ROLES,
  NAV_SURFACES,
  SURFACES,
  isEditableSurface,
  surfaceAccessSetSchema,
  type SurfaceAccessSetRequest,
  type SurfaceClaim,
  type SurfaceOverrides,
  type UserRole,
} from "@silvicom/shared";
import { requireAuth, requireRole, requireOrg } from "../../../middleware/auth.js";
import { validateBody, apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The per-org SCREEN entitlements (D-SURF1, SURFACE-ENTITLEMENTS-PLAN.md step S3).
 *
 * The sibling of `sectionAccess.ts`, and deliberately the same arrangement, for the same reason:
 * `org_role_surface_access` (0296) has a SELECT policy and no write policy at all, so PostgREST
 * cannot change it — not even for an org admin. Changing what a role may reach is exactly the act
 * that must leave an audit row, and this is the only path that writes one.
 *
 * ⚠ The API reads with the SERVICE ROLE, which bypasses RLS, so every query below carries its own
 * `.eq("org_id", …)`; `surfaceAccess.test.ts` asserts it with `expectOrgScoped`.
 */

const ROW_COLS = "role, surface_key, allowed";

interface SurfaceRow {
  role: string;
  surface_key: string;
  allowed: boolean;
}

const KNOWN_KEYS = new Set(SURFACES.filter((s) => isEditableSurface(s) && !s.parent).map((s) => s.key));

/**
 * Rows → the sparse `role → key → allowed` shape the shared resolver takes (D-SURF6).
 *
 * Rows naming an uneditable role, or a key the catalogue does not have, are SKIPPED rather than
 * trusted. 0296 deliberately leaves `surface_key` unconstrained because a bad key is inert in SQL —
 * this is where "inert" is actually made true, and it matters most for a key that USED to exist:
 * a screen removed from the catalogue must not leave its old denial applying to nothing, or worse,
 * to a key some later surface reuses.
 */
export function toSurfaceOverrides(rows: SurfaceRow[]): SurfaceOverrides {
  const out: SurfaceOverrides = {};
  for (const r of rows) {
    if (!(EDITABLE_ROLES as string[]).includes(r.role)) continue;
    if (!KNOWN_KEYS.has(r.surface_key)) continue;
    (out[r.role as UserRole] ??= {})[r.surface_key] = r.allowed;
  }
  return out;
}

/**
 * One caller's slice — the answers for their own role, which is all `/api/me` needs to send.
 *
 * Returns `{}` rather than throwing when the table cannot be read. That is a deliberate fail-OPEN,
 * and it is safe because of what this claim can and cannot do: a surface entitlement may only
 * NARROW within a section (D-SURF2), so an empty claim is the shipped catalogue, never more than it.
 * The alternative — failing closed — would turn a transient database blip into every member of the
 * org losing their sidebar, and the section gate underneath is untouched either way.
 */
export async function surfaceClaimFor(
  admin: SupabaseClient,
  orgId: string,
  role: UserRole | null,
): Promise<SurfaceClaim> {
  if (!role || !(EDITABLE_ROLES as string[]).includes(role)) return {};
  const { data, error } = await admin
    .from("org_role_surface_access")
    .select(ROW_COLS)
    .eq("org_id", orgId)
    .eq("role", role);
  if (error) return {};
  return toSurfaceOverrides((data ?? []) as SurfaceRow[])[role] ?? {};
}

export function surfaceAccessRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  /**
   * The org's answers, plus the catalogue they are read against.
   *
   * Both halves in one response for `sectionAccess.ts`'s reason: answering with the overrides alone
   * would make the client reconstruct the defaults, which is a second copy of the catalogue and the
   * restatement D-SURF3 exists to avoid.
   */
  router.get(
    "/",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const { data, error } = await admin
        .from("org_role_surface_access")
        .select(ROW_COLS)
        .eq("org_id", req.auth!.orgId!);
      if (error) {
        res.status(500).json(apiError("db_error", "Could not load screen permissions"));
        return;
      }
      res.json({
        overrides: toSurfaceOverrides((data ?? []) as SurfaceRow[]),
        // Only the editable ones: a `staff` or `admin` gated screen is a product constant an org may
        // not deny (Q-SURF3), and offering it as a cell would be a control that saves nothing.
        surfaces: NAV_SURFACES.filter(isEditableSurface).map((s) => ({
          key: s.key,
          label: s.label,
          group: s.group,
          section: s.gate.kind === "section" ? s.gate.section : null,
        })),
        editableRoles: EDITABLE_ROLES,
      });
    }),
  );

  /**
   * Set one cell.
   *
   * Allowing a screen back DELETES the row rather than storing `true`. The table is a sparse delta
   * (D-SURF6) and "no row" is how it says "unchanged" — a stored `true` would still read as a
   * deliberate answer on the page, and would keep applying after the surface's own gate changed
   * underneath it. `allowed: false` is therefore the only value that ever produces a row at THIS
   * layer; S4's per-user layer is where a `true` earns its keep, overriding a role-level denial.
   */
  router.put(
    "/",
    requireOrg,
    requireRole("admin"),
    validateBody(surfaceAccessSetSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const { role, surfaceKey, allowed } = res.locals.body as SurfaceAccessSetRequest;

      // Never `.upsert()` with a partial payload (`lint:upserts`): Postgres checks NOT NULL before
      // conflict arbitration. Delete-then-insert is the shape 0174/0175 settled on, and the primary
      // key makes the pair idempotent.
      const { error: delErr } = await admin
        .from("org_role_surface_access")
        .delete()
        .eq("org_id", orgId)
        .eq("role", role)
        .eq("surface_key", surfaceKey);
      if (delErr) {
        res.status(500).json(apiError("db_error", "Could not update screen permissions"));
        return;
      }
      if (!allowed) {
        const { error: insErr } = await admin.from("org_role_surface_access").insert({
          org_id: orgId,
          role,
          surface_key: surfaceKey,
          allowed: false,
          updated_by: req.auth!.userId,
        });
        if (insErr) {
          res.status(500).json(apiError("db_error", "Could not update screen permissions"));
          return;
        }
      }

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "permissions.screen_changed",
        entity: "org_role_surface_access",
        meta: { role, surfaceKey, allowed, resetToDefault: allowed },
      });
      res.json({ ok: true, role, surfaceKey, allowed });
    }),
  );

  return router;
}
