import { Router } from "express";
import { canArchiveDriver, rolesThatCanView } from "@fuelguard/shared";
import { requireAuth, requireOrg, requireRole } from "../../middleware/auth.js";
import { apiError, asyncHandler } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../lib/appLocals.js";
import { writeAudit } from "../../lib/audit.js";

/**
 * Archiving a driver or an applicant (migration 0235).
 *
 * ── WHY THIS IS ITS OWN ROUTER ────────────────────────────────────────────────────────────────
 * `routes/roster/drivers.ts` is 415 lines against a 500-line budget that warns at 450, and §4's own
 * rule is that a route file with six verbs starts split rather than budget-diving. `credentials.ts`
 * is the precedent: it mounts on the same `/api/roster/drivers` path and owns one concern.
 *
 * ── WHY ARCHIVING IS AN ENDPOINT AND NOT A `PATCH` FIELD ──────────────────────────────────────
 * It could have been `PATCH { archived: true }` through the existing driver update. It is not, for
 * two reasons that are the same reason twice:
 *
 *   1. **The gate is different.** Every other field on that PATCH is gated by `canWriteDriver`, and
 *      archiving is gated by `canArchiveDriver`, which depends on the DRIVER'S STATUS as well as the
 *      caller's role — an applicant is the recruiter's to tidy away, anyone else on the roster is the
 *      fleet's. A conditional gate buried inside a general-purpose update is a gate somebody removes.
 *   2. **The audit row is different.** Hiding a person from the roster deserves its own action name,
 *      not `driver.updated` with `archived_at` among the changed fields. An auditor asking "when did
 *      this driver stop appearing, and who did that" should not have to read field diffs.
 *
 * ⚠ **The API is the ONLY writer, and the database enforces that.** 0235's
 * `guard_driver_archive_writer` refuses `archived_at` to every JWT-bearing writer (DR011). 0212
 * grants `recruiter` UPDATE on `drivers` by name, so without that trigger a recruiter could archive
 * through PostgREST and the act would have no audit row — the one roster act that left no trace.
 *
 * ⚠ **Archiving is reversible and hard-deleting is not possible.** `DELETE` on `drivers` raises
 * DR010 for everybody including the service role (0235, on 0096's `messages` precedent), because
 * `drivers` is in `RETENTION_FORBIDDEN`: §391.51 keeps a qualification file for as long as the driver
 * is employed plus three years, and §390.32(d) wants it reproducible. Un-archiving is therefore a
 * real affordance rather than a courtesy — it is the only undo there is.
 */
export function rosterArchiveRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  // View-level gate at the door; the act-level gate is `canArchiveDriver` below, which needs the
  // driver's status and so cannot be a middleware.
  const canSeeRoster = requireRole(...rolesThatCanView("fleet"), ...rolesThatCanView("recruitment"));

  /**
   * Archive (`POST /:id/archive`) and un-archive (`POST /:id/unarchive`) are one handler: they differ
   * in a timestamp and a verb, and writing them twice is how the two gates drift apart.
   */
  const setArchived = (archive: boolean) =>
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const id = String(req.params.id ?? "");

      // Read first: the gate depends on WHOSE list this row is on. Tenant scope on the query, not on
      // the result — a cross-org id must be indistinguishable from one that does not exist.
      const { data: current, error: readErr } = await admin
        .from("drivers")
        .select("id, full_name, status, archived_at")
        .eq("id", id)
        .eq("org_id", orgId)
        .maybeSingle();
      if (readErr) {
        res.status(500).json(apiError("db_error", "Could not load driver"));
        return;
      }
      if (!current) {
        res.status(404).json(apiError("not_found", "Driver not found"));
        return;
      }

      const status = (current as { status: string | null }).status;
      if (!canArchiveDriver(req.auth!.role, status)) {
        res
          .status(403)
          .json(apiError("forbidden", "Archiving a driver on the roster is a fleet action."));
        return;
      }

      // Already in the requested state: answer with the row rather than writing a no-op and an audit
      // entry for it. A second click on a stale list should not produce a second "archived" event.
      const alreadyArchived = (current as { archived_at: string | null }).archived_at !== null;
      if (alreadyArchived === archive) {
        res.json({ driver: current });
        return;
      }

      const { data, error } = await admin
        .from("drivers")
        .update({ archived_at: archive ? new Date().toISOString() : null })
        .eq("id", id)
        .eq("org_id", orgId)
        .select("id, full_name, status, archived_at")
        .single();
      if (error || !data) {
        res.status(500).json(apiError("db_error", "Could not archive driver"));
        return;
      }

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: archive ? "driver.archived" : "driver.unarchived",
        entity: "drivers",
        entityId: id,
        meta: { fullName: (current as { full_name: string | null }).full_name, status },
      });

      res.json({ driver: data });
    });

  router.post("/:id/archive", requireOrg, canSeeRoster, setArchived(true));
  router.post("/:id/unarchive", requireOrg, canSeeRoster, setArchived(false));

  return router;
}
