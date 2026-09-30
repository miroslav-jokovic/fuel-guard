import { Router, type Request } from "express";
import { orgNotificationsFormSchema, orgProfileFormSchema, type OrgProfileForm } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { requireSurface } from "../../../middleware/requireSurface.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";

/**
 * The two Settings screens that write `organizations` (SETTINGS-PERMISSIONS-PLAN.md SP2).
 *
 * Until SP2 the browser wrote the row straight through PostgREST, and the only gate was the
 * `organizations_update` RLS policy, which says `admin`. That is a ROLE test the Permissions page
 * cannot answer: a fleet manager an admin gave Organization to (Q-SET2) could open the page and
 * every save was refused. Each write now asks what its screen asks — the section, then the screen
 * itself (D-SURF5: each endpoint here is reached from exactly one screen) — so the grant on the
 * Permissions page is the grant the save obeys. SP3 then drops the client write policy.
 *
 * ── ONE ENDPOINT PER SCREEN, EACH WRITING ONLY ITS OWN COLUMNS ────────────────────────────────────
 * Not one "save the organisation" endpoint with both gates on it: Organization and Notifications
 * are separate grants, and a PUT carrying both halves would need both, or would let one screen's
 * grant write the other's fields. The column split is also what fixes the Notifications page's
 * erasure of the DOT number and address (see `orgProfileFormSchema`).
 *
 * The API reads with the service role, which bypasses RLS: every write filters on the caller's own
 * org id, from the token, never from the body.
 */
export function orgSettingsRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  router.use(requireOrg);

  router.put(
    "/profile",
    requireSection("settings"),
    requireSurface("admin.settings.org"),
    validateBody(orgProfileFormSchema),
    asyncHandler(async (req, res) => {
      const form = res.locals.body as OrgProfileForm;
      const saved = await update(req, "settings.org_saved", {
        name: form.name,
        // Empty means "not recorded", and null is how the column says that — an empty string would
        // print as a blank USDOT line on every binder cover rather than as an honest absence.
        dot_number: form.dot_number ? form.dot_number : null,
        // Same rule, same reason: empty means "not recorded", and the annual inspection says so by
        // refusing to certify rather than printing a blank carrier block (0282, §396.21(a)(2)).
        address_line1: form.address_line1 ? form.address_line1 : null,
        city: form.city ? form.city : null,
        state: form.state ? form.state : null,
        postal_code: form.postal_code ? form.postal_code : null,
        operating_hours: form.operating_hours,
      });
      if (!saved) {
        res.status(500).json(apiError("db_error", "Could not save the organization"));
        return;
      }
      res.json({ ok: true });
    }),
  );

  router.put(
    "/notifications",
    requireSection("settings"),
    requireSurface("admin.settings.notifications"),
    validateBody(orgNotificationsFormSchema),
    asyncHandler(async (req, res) => {
      const saved = await update(req, "settings.notifications_saved", res.locals.body as Record<string, unknown>);
      if (!saved) {
        res.status(500).json(apiError("db_error", "Could not save notification settings"));
        return;
      }
      res.json({ ok: true });
    }),
  );

  return router;
}

/** One UPDATE of the caller's own org row, audited with the columns it touched (never the values). */
async function update(req: Request, action: string, patch: Record<string, unknown>): Promise<boolean> {
  const admin = getSupabaseAdmin(getAppLocals(req).env);
  const orgId = req.auth!.orgId!;
  const { error } = await admin.from("organizations").update(patch).eq("id", orgId);
  if (error) return false;
  await writeAudit(admin, {
    orgId,
    actorId: req.auth!.userId,
    action,
    entity: "organizations",
    entityId: orgId,
    meta: { fields: Object.keys(patch) },
  });
  return true;
}
