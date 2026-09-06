import { Router } from "express";
import { z } from "zod";
import {
  EDITABLE_ROLES,
  NAV_SURFACES,
  SURFACES,
  isEditableSurface,
  surfaceAccessSetSchema,
  userSurfaceAccessSetSchema,
  type SurfaceAccessSetRequest,
  type SurfaceClaim,
  type SurfaceOverrides,
  type UserRole,
  type UserSurfaceAccessSetRequest,
} from "@silvicom/shared";
import { requireAuth, requireRole, requireOrg } from "../../../middleware/auth.js";
import { validateBody, apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { lookupMemberRole } from "../memberLookup.js";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The per-org SCREEN entitlements (D-SURF1, SURFACE-ENTITLEMENTS-PLAN.md step S3).
 *
 * The sibling of `sectionAccess.ts`, and deliberately the same arrangement, for the same reason:
 * `org_role_surface_access` (0296) and `user_surface_access` (0298) each have a SELECT policy and no
 * write policy at all, so PostgREST cannot change either — not even for an org admin. Changing what
 * a role or a person may reach is exactly the act that must leave an audit row, and this is the only
 * path that writes one.
 *
 * Two layers of one chain live here (D-SURF6): `PUT /` answers for a ROLE, `PUT /user` answers for a
 * PERSON, and `surfaceClaimFor` resolves the second over the first. They are not symmetric and the
 * asymmetry is documented at each — a `true` is a reset at the role layer and a real answer at the
 * user layer, because only the user layer can be overriding a denial.
 *
 * ⚠ The API reads with the SERVICE ROLE, which bypasses RLS, so every query below carries its own
 * `.eq("org_id", …)`; `surfaceAccess.test.ts` asserts it with `expectOrgScoped`.
 */

const ROW_COLS = "role, surface_key, allowed";
const USER_ROW_COLS = "surface_key, allowed";

interface SurfaceRow {
  role: string;
  surface_key: string;
  allowed: boolean;
}

interface UserSurfaceRow {
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
 * The rows for ONE member, sparse (D-SURF7). Unlike the role layer, `true` is a real answer here —
 * it is how a single technician keeps a screen the org took from `technician` — so nothing is
 * filtered on value, only on whether the catalogue still knows the key.
 */
export function toUserSurfaceClaim(rows: UserSurfaceRow[]): SurfaceClaim {
  const out: SurfaceClaim = {};
  for (const r of rows) {
    if (!KNOWN_KEYS.has(r.surface_key)) continue;
    out[r.surface_key] = r.allowed;
  }
  return out;
}

/**
 * One caller's slice — the answers for their own role, with their OWN answers merged over the top
 * (D-SURF6: shipped gate → org role override → user override). All `/api/me` needs to send.
 *
 * ⚠ The `EDITABLE_ROLES` guard stands FIRST and must stay there. It is the read half of the
 * D-PERM7/D-PERM8 lock that migration 0298 explains it cannot express as a CHECK: this table is
 * keyed by `user_id` and a row does not know its member's role, so if a row for an `admin` ever
 * exists — a restore, a support action, a future writer — this line is what declines to honour it.
 *
 * ── FAIL OPEN, PER LAYER ──────────────────────────────────────────────────────────────────────
 * Each read that fails contributes nothing and the other still applies; neither failure denies
 * anything. That is safe because of what this claim can and cannot do: a surface entitlement may
 * only NARROW within a section (D-SURF2), so an empty claim is the shipped catalogue, never more
 * than it. Failing closed would turn a transient database blip into every member of the org losing
 * their sidebar, while the section gate underneath — the actual security boundary — is untouched.
 *
 * The USER half failing open is also what licenses S4 shipping its table and its reader in ONE
 * merge, against D-SURF9's two-merge rule: for the ~9 minutes between a deploy being served and its
 * migration being applied, the missing table is a query error, the user layer does not apply, and
 * the role layer answers exactly as it did before. Pinned by surfaceAccess.test.ts —
 * "returns the role's answers unchanged when the user table cannot be read".
 */
export async function surfaceClaimFor(
  admin: SupabaseClient,
  orgId: string,
  role: UserRole | null,
  userId?: string | null,
): Promise<SurfaceClaim> {
  if (!role || !(EDITABLE_ROLES as string[]).includes(role)) return {};
  const [roleRes, userRes] = await Promise.all([
    admin.from("org_role_surface_access").select(ROW_COLS).eq("org_id", orgId).eq("role", role),
    userId
      ? admin.from("user_surface_access").select(USER_ROW_COLS).eq("org_id", orgId).eq("user_id", userId)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const fromRole = roleRes.error ? {} : (toSurfaceOverrides((roleRes.data ?? []) as SurfaceRow[])[role] ?? {});
  const fromUser = userRes.error ? {} : toUserSurfaceClaim((userRes.data ?? []) as UserSurfaceRow[]);
  // The user's answers win, which is the whole of D-SURF6's third layer. `surfaceAllowed` in shared
  // still checks the surface's own gate FIRST, so a `true` here can never reach past the section.
  return { ...fromRole, ...fromUser };
}

/**
 * The screens an org may actually answer for, sent with every read (D-SURF3).
 *
 * Only the editable ones: a `staff` or `admin` gated screen is a product constant an org may not
 * deny (Q-SURF3), and offering it as a cell would be a control that saves nothing.
 *
 * `section` and `level` travel with each entry because the page cannot draw the cell without them —
 * a screen inside a section the role does not hold is not a choice an admin has (D-SURF2), and
 * saying "hidden, because they have no Maintenance access" is the difference between a disabled
 * control and a broken one. Derived from the catalogue rather than restated, so a screen that moves
 * section moves here with it.
 */
const EDITABLE_CATALOGUE = NAV_SURFACES.filter(isEditableSurface).map((s) => ({
  key: s.key,
  label: s.label,
  group: s.group,
  section: s.gate.kind === "section" ? s.gate.section : null,
  level: s.gate.kind === "section" ? s.gate.level : null,
}));

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
        surfaces: EDITABLE_CATALOGUE,
        editableRoles: EDITABLE_ROLES,
      });
    }),
  );

  /**
   * One MEMBER's two layers of screen answers, unresolved (S6, D-SURF6).
   *
   * The sibling of `GET /api/section-access/user/:userId`, and it separates the layers for that
   * endpoint's reason: `surfaceClaimFor` above merges them and forgets which one answered, because
   * that is all a request needs. A page whose cell cannot say whether a screen is hidden for the
   * whole ROLE or for this PERSON is a page an admin cannot use — "reset" and "hide" would be the
   * same control.
   *
   * ⚠ There is no `shipped` half to send, and its absence is the design rather than an omission. A
   * surface has no per-screen shipped default: the shipped answer is the surface's own GATE, which
   * is the section question, and it travels in `surfaces[].section` / `.level` for the page to ask
   * against the member's section access. An org's row can only narrow within that (D-SURF2).
   *
   * ⚠ Read-only, and it does NOT apply the D-PERM7/D-PERM8 lock — see the section sibling's header.
   */
  router.get(
    "/user/:userId",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const parsedId = z.uuid().safeParse(req.params.userId);
      if (!parsedId.success) {
        res.status(400).json(apiError("bad_request", "That is not a member id"));
        return;
      }
      const userId = parsedId.data;

      const member = await lookupMemberRole(admin, orgId, userId);
      if (!member.ok) {
        if (member.reason === "db_error") {
          res.status(500).json(apiError("db_error", "Could not load screen permissions"));
        } else {
          res.status(404).json(apiError("not_found", "That person is not a member of this organisation"));
        }
        return;
      }

      const [roleRes, userRes] = await Promise.all([
        admin.from("org_role_surface_access").select(ROW_COLS).eq("org_id", orgId).eq("role", member.role),
        admin.from("user_surface_access").select(USER_ROW_COLS).eq("org_id", orgId).eq("user_id", userId),
      ]);
      if (roleRes.error || userRes.error) {
        res.status(500).json(apiError("db_error", "Could not load screen permissions"));
        return;
      }

      res.json({
        userId,
        role: member.role,
        roleOverrides: toSurfaceOverrides((roleRes.data ?? []) as SurfaceRow[])[member.role as UserRole] ?? {},
        userOverrides: toUserSurfaceClaim((userRes.data ?? []) as UserSurfaceRow[]),
        surfaces: EDITABLE_CATALOGUE,
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

  /**
   * Set one cell for one MEMBER (S4, D-SURF7) — the layer that answers "custom setup for each user".
   *
   * ── WHY `allowed: null` RATHER THAN THE ROLE ROUTE'S DELETE-ON-TRUE ──────────────────────────
   * Above, `allowed: true` deletes the row, because a `true` at the ROLE layer is inert: the
   * surface's own gate is checked first, so an allow cannot lift a role past a section it lacks
   * (D-SURF2). Here both booleans are real answers — `false` takes a screen from one member their
   * role keeps, `true` gives one back to a member whose role has lost it, which is the row 0296's
   * boolean column was added for — so "unchanged" needs a third value, and it is `null`, stored as
   * the absence of a row (D-SURF6's sparseness, unchanged).
   *
   * ── THE ROLE LOCK IS ENFORCED HERE BECAUSE SQL CANNOT ────────────────────────────────────────
   * ⚠ `user_surface_access` is keyed by `user_id`, and a row does not know its member's role — that
   * lives in `memberships` and can change after the row is written, so 0298 has no
   * `role not in ('admin','driver')` CHECK where 0296 does. This lookup is one of the two places
   * that lock survives (the other is `surfaceClaimFor`, which answers `{}` for a locked role before
   * reading anything). It is org-scoped as well as user-scoped, so it doubles as the check that the
   * target is a member of the CALLER's org: the service role bypasses RLS and the composite foreign
   * key would otherwise be the only thing standing between an admin and another tenant's rows —
   * which would surface as a 500, not as a refusal.
   */
  router.put(
    "/user",
    requireOrg,
    requireRole("admin"),
    validateBody(userSurfaceAccessSetSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const { userId, surfaceKey, allowed } = res.locals.body as UserSurfaceAccessSetRequest;

      const member = await lookupMemberRole(admin, orgId, userId);
      if (!member.ok) {
        if (member.reason === "db_error") {
          res.status(500).json(apiError("db_error", "Could not update screen permissions"));
        } else {
          res.status(404).json(apiError("not_found", "That person is not a member of this organisation"));
        }
        return;
      }
      if (!(EDITABLE_ROLES as string[]).includes(member.role)) {
        res
          .status(400)
          .json(apiError("role_locked", "That member's screens cannot be changed (D-PERM7/D-PERM8)"));
        return;
      }

      // Never `.upsert()` with a partial payload (`lint:upserts`): Postgres checks NOT NULL before
      // conflict arbitration. Delete-then-insert is the shape 0174/0175 settled on, and the primary
      // key makes the pair idempotent.
      const { error: delErr } = await admin
        .from("user_surface_access")
        .delete()
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .eq("surface_key", surfaceKey);
      if (delErr) {
        res.status(500).json(apiError("db_error", "Could not update screen permissions"));
        return;
      }
      if (allowed !== null) {
        const { error: insErr } = await admin.from("user_surface_access").insert({
          org_id: orgId,
          user_id: userId,
          surface_key: surfaceKey,
          allowed,
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
        action: "permissions.screen_changed_user",
        entity: "user_surface_access",
        // The member's role travels with the change so the log reads without the reader having to
        // reconstruct who held what on the day it was written — the same reason the role-level audit
        // carries the shipped default.
        meta: {
          userId,
          role: member.role,
          surfaceKey,
          allowed,
          resetToRole: allowed === null,
        },
      });
      res.json({ ok: true, userId, surfaceKey, allowed });
    }),
  );

  return router;
}
