import { Router } from "express";
import {
  APP_SECTIONS,
  EDITABLE_ROLES,
  EDITABLE_SECTIONS,
  sectionAccess,
  sectionAccessSetSchema,
  userSectionAccessSetSchema,
  type AppSection,
  type SectionAccessSetRequest,
  type SectionOverrides,
  type UserRole,
  type UserSectionAccessSetRequest,
} from "@silvicom/shared";
import { requireAuth, requireRole, requireOrg } from "../../../middleware/auth.js";
import { validateBody, apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";

/**
 * The per-org permission overrides (D-PERM1, EDITABLE-PERMISSIONS-PLAN.md step P1).
 *
 * ── WHY EVERY WRITE COMES THROUGH HERE ──────────────────────────────────────────────────────────
 * `org_section_access` (0291) has a SELECT policy and no write policy at all, so PostgREST cannot
 * change it — not even for an org admin. That is deliberate and it is the reason this router
 * exists: changing what a role may do is exactly the act that must leave an audit row, and this is
 * the only path that writes one. It is 0235's arrangement for `archived_at` read the same way —
 * one path in, so the rule lives in one place rather than two that can disagree.
 *
 * ⚠ The API reads with the SERVICE ROLE, which bypasses RLS, so every query below carries its own
 * `.eq("org_id", …)`. `sectionAccess.test.ts` asserts it with `expectOrgScoped`.
 *
 * ── WHAT READS THESE ROWS ───────────────────────────────────────────────────────────────────────
 * Nothing here. `custom_access_token_hook` turns them into the sparse `sections` JWT claim at token
 * mint (P2, migration 0292), and the policies P4 wrote branch on it through `auth_section()`. This
 * router only writes. That asymmetry is why nothing in this file resolves anything: a resolver here
 * would be a second opinion about a question SQL already answers, on the read path of every row.
 *
 * Two layers of one chain live here (D-SURF6): `PUT /` answers for a ROLE (0291) and `PUT /user`
 * answers for a PERSON (0299), and the hook merges the second OVER the first. They are not
 * symmetric — writing a cell back to its shipped default is a RESET at the role layer and a real
 * answer at the user layer, because a person has no shipped default to compare against — and each
 * says so where a reader will look.
 */

const OVERRIDE_COLS = "role, section, access, updated_at, updated_by";

interface OverrideRow {
  role: string;
  section: string;
  access: string;
}

/** Rows → the sparse `role → section → access` shape the shared resolver takes (D-PERM4). */
export function toOverrides(rows: OverrideRow[]): SectionOverrides {
  const out: SectionOverrides = {};
  for (const r of rows) {
    // A row for an uneditable role or section cannot be written and is skipped rather than trusted.
    // The CHECK constraints in 0291 refuse it and the schema below refuses it first, so reaching
    // this means a row exists that should not — and honouring it would be an escalation.
    if (!(EDITABLE_ROLES as string[]).includes(r.role)) continue;
    if (!(EDITABLE_SECTIONS as string[]).includes(r.section)) continue;
    if (r.access !== "none" && r.access !== "view" && r.access !== "manage") continue;
    const role = r.role as UserRole;
    (out[role] ??= {})[r.section as AppSection] = r.access;
  }
  return out;
}

export function sectionAccessRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  /**
   * The org's overrides, plus the shipped matrix they are read against.
   *
   * Both halves in one response on purpose: the caller's question is "what does this org's matrix
   * look like", and answering it from the overrides alone would make the client reconstruct the
   * defaults — a second copy of `SECTION_ACCESS`, which is the restatement D-PERM4 exists to avoid.
   */
  router.get(
    "/",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const { data, error } = await admin
        .from("org_section_access")
        .select(OVERRIDE_COLS)
        .eq("org_id", req.auth!.orgId!);
      if (error) {
        res.status(500).json(apiError("db_error", "Could not load permissions"));
        return;
      }
      res.json({
        overrides: toOverrides((data ?? []) as OverrideRow[]),
        defaults: Object.fromEntries(
          EDITABLE_ROLES.map((r) => [
            r,
            Object.fromEntries(APP_SECTIONS.map((s) => [s, sectionAccess(r, s)])),
          ]),
        ),
        editableRoles: EDITABLE_ROLES,
        editableSections: EDITABLE_SECTIONS,
      });
    }),
  );

  /**
   * Set one cell.
   *
   * Setting a cell back to its shipped default DELETES the row rather than storing the default
   * value. The table is a sparse delta (D-PERM4) and "no row" is its way of saying "unchanged" — a
   * stored row that happens to equal the default would still read as a deliberate override on the
   * page, and would silently stop tracking a future change to the shipped matrix.
   */
  router.put(
    "/",
    requireOrg,
    requireRole("admin"),
    validateBody(sectionAccessSetSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const { role, section, access } = res.locals.body as SectionAccessSetRequest;
      const shipped = sectionAccess(role as UserRole, section as AppSection);
      const isDefault = access === shipped;

      // Never `.upsert()` with a partial payload (`lint:upserts`): Postgres checks NOT NULL before
      // conflict arbitration. Delete-then-insert inside one request is the shape 0174/0175 settled
      // on, and the primary key makes the pair idempotent.
      const { error: delErr } = await admin
        .from("org_section_access")
        .delete()
        .eq("org_id", orgId)
        .eq("role", role)
        .eq("section", section);
      if (delErr) {
        res.status(500).json(apiError("db_error", "Could not update permissions"));
        return;
      }
      if (!isDefault) {
        const { error: insErr } = await admin.from("org_section_access").insert({
          org_id: orgId,
          role,
          section,
          access,
          updated_by: req.auth!.userId,
        });
        if (insErr) {
          res.status(500).json(apiError("db_error", "Could not update permissions"));
          return;
        }
      }

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "permissions.changed",
        entity: "org_section_access",
        // The default value travels with the change so the log reads without the reader having to
        // know what the product shipped on the day it was written.
        meta: { role, section, access, shipped, resetToDefault: isDefault },
      });
      res.json({ ok: true, role, section, access, isDefault });
    }),
  );

  /**
   * Set one cell for one MEMBER (S5, D-SURF7) — "custom setup for each user", for DATA rather than
   * for screens.
   *
   * ── WHY `access: null` RATHER THAN THE ROLE ROUTE'S DELETE-ON-DEFAULT ────────────────────────
   * Above, writing a cell back to its shipped value deletes the row, because `sectionAccess(role,
   * section)` is a default the endpoint can compare against. A PERSON has no shipped default — their
   * fallback is whatever their role resolves to, which an admin can change afterwards — so "inherit"
   * cannot be one of the three access values without freezing today's answer into a row that would
   * stop tracking the role. It is the absence of a row, and `null` is how a caller asks for it. Same
   * three-valued shape as `surfaceAccess.ts`'s per-user write, for the same reason.
   *
   * ── WHAT ENFORCES WHAT, SINCE THIS IS THE SECURITY BOUNDARY AND NOT MERELY THE MENU ──────────
   * ⚠ The `admin` SECTION is refused three times — by the schema, by 0299's CHECK constraint, and by
   * `custom_access_token_hook`, which will not put it in a claim whatever rows exist. That is
   * D-PERM7, and it is a boundary rather than manners: `admin` carries user management, so granting
   * it sideways would be the privilege-escalation path the product deliberately does not have.
   *
   * ⚠ The admin/driver ROLE lock cannot be a CHECK on a user-keyed table (0299's header explains
   * why), so it lives here — an org-scoped `memberships` lookup, which doubles as the check that the
   * target belongs to the CALLER's org, since the service role bypasses RLS — and in the hook, which
   * is the layer that actually matters because it is the one standing between a row and a claim.
   *
   * ── STALENESS ────────────────────────────────────────────────────────────────────────────────
   * A section answer travels in the JWT (D-PERM2), so this change lands when the member's token next
   * refreshes — up to `jwt_expiry`, which is 3600. That is D-PERM6's accepted contract and the UI is
   * required to say so. It is NOT the contract for a SURFACE change, which lands on the next page
   * load (D-SURF4); the difference is real and S6's page must not average the two.
   */
  router.put(
    "/user",
    requireOrg,
    requireRole("admin"),
    validateBody(userSectionAccessSetSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const { userId, section, access } = res.locals.body as UserSectionAccessSetRequest;

      const { data: member, error: memberErr } = await admin
        .from("memberships")
        .select("role")
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .maybeSingle();
      if (memberErr) {
        res.status(500).json(apiError("db_error", "Could not update permissions"));
        return;
      }
      if (!member) {
        res.status(404).json(apiError("not_found", "That person is not a member of this organisation"));
        return;
      }
      const memberRole = (member as { role: string }).role;
      if (!(EDITABLE_ROLES as string[]).includes(memberRole)) {
        res
          .status(400)
          .json(apiError("role_locked", "That member's access cannot be changed (D-PERM7/D-PERM8)"));
        return;
      }

      // Never `.upsert()` with a partial payload (`lint:upserts`): Postgres checks NOT NULL before
      // conflict arbitration. Delete-then-insert is the shape 0174/0175 settled on, and the primary
      // key makes the pair idempotent.
      const { error: delErr } = await admin
        .from("user_section_access")
        .delete()
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .eq("section", section);
      if (delErr) {
        res.status(500).json(apiError("db_error", "Could not update permissions"));
        return;
      }
      if (access !== null) {
        const { error: insErr } = await admin.from("user_section_access").insert({
          org_id: orgId,
          user_id: userId,
          section,
          access,
          updated_by: req.auth!.userId,
        });
        if (insErr) {
          res.status(500).json(apiError("db_error", "Could not update permissions"));
          return;
        }
      }

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "permissions.changed_user",
        entity: "user_section_access",
        // The member's role and what that role would have resolved to travel with the change, so
        // the log reads without the reader having to reconstruct the matrix as it stood that day —
        // the same reason the role-level audit carries `shipped`.
        meta: {
          userId,
          role: memberRole,
          section,
          access,
          roleDefault: sectionAccess(memberRole as UserRole, section as AppSection),
          resetToRole: access === null,
        },
      });
      res.json({ ok: true, userId, section, access });
    }),
  );

  return router;
}
