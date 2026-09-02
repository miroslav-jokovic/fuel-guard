import { Router } from "express";
import {
  APP_SECTIONS,
  EDITABLE_ROLES,
  EDITABLE_SECTIONS,
  sectionAccess,
  sectionAccessSetSchema,
  type AppSection,
  type SectionAccessSetRequest,
  type SectionOverrides,
  type UserRole,
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
 * `org_section_access` (0290) has a SELECT policy and no write policy at all, so PostgREST cannot
 * change it — not even for an org admin. That is deliberate and it is the reason this router
 * exists: changing what a role may do is exactly the act that must leave an audit row, and this is
 * the only path that writes one. It is 0235's arrangement for `archived_at` read the same way —
 * one path in, so the rule lives in one place rather than two that can disagree.
 *
 * ⚠ The API reads with the SERVICE ROLE, which bypasses RLS, so every query below carries its own
 * `.eq("org_id", …)`. `sectionAccess.test.ts` asserts it with `expectOrgScoped`.
 *
 * ── WHAT THIS DOES NOT DO YET ───────────────────────────────────────────────────────────────────
 * Nothing reads these rows at authorization time. The auth hook that turns them into a JWT claim is
 * P2 and the policies that consult that claim are P4; until both land, an override is recorded and
 * inert. It ships now rather than with P5 because a table with no producer is the failure
 * `check-table-producers.mjs` was written for — "schema that nothing writes is not infrastructure,
 * it is a promise nobody is keeping" — and because the audit trail should exist from the first row
 * rather than be retrofitted around rows that predate it.
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
    // The CHECK constraints in 0290 refuse it and the schema below refuses it first, so reaching
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

  return router;
}
