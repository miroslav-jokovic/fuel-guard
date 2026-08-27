import { Router } from "express";
import {
  canWriteDriverLifecycle,
  rolesThatCanView,
  sevenDayStatementCreateSchema,
  sevenDayWindowMismatch,
  type SevenDayStatementCreate,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireRole } from "../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../lib/appLocals.js";
import { writeAudit } from "../../lib/audit.js";

/**
 * The §395.8(j)(2) seven-day work statement (P7, D-PKT7, migration 0236).
 *
 * ── WHY IT LIVES ON THE ROSTER AND NOT IN RECRUITMENT ─────────────────────────────────────────
 * It is obtained when somebody is put to work, not when they apply — the regulation counts the seven
 * days preceding the day the driver BEGINS work, so an application-time answer describes the wrong
 * week. Recording one is therefore a fleet act, gated by `canWriteDriverLifecycle`, the same set 0213
 * allows to move a driver through their employment status and for the same reason.
 *
 * ── WHY THERE IS NO PATCH ─────────────────────────────────────────────────────────────────────
 * ⚠ The driver signs this. 0236 refuses UPDATE for everybody, service role included (SD010), because
 * a signed statement somebody can edit afterwards is not a statement. A correction is a new row, and
 * the list is ordered newest-first so the current one is the first one.
 *
 * ── AND WHY THE WINDOW IS CHECKED HERE RATHER THAN TRUSTED ────────────────────────────────────
 * The hours are summed against a window. A statement whose dates drifted produces a lawful-looking
 * total that is not, which is the one failure mode of this record that nobody would notice.
 */

const COLS = "id, driver_id, statement_date, days, last_relieved_at, signed_name, signed_on, created_at";

export function rosterSevenDayRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  const canView = requireRole(...rolesThatCanView("fleet"));

  router.get(
    "/:id/seven-day-statements",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const { data, error } = await admin
        .from("seven_day_statements")
        .select(COLS)
        // Tenant scope on the query, not on the result: a cross-org id must be indistinguishable
        // from one that does not exist.
        .eq("org_id", req.auth!.orgId!)
        .eq("driver_id", String(req.params.id ?? ""))
        // Newest first — a correction is a new row, so the current statement is the first one.
        .order("statement_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) {
        res.status(500).json(apiError("db_error", "Could not load the seven-day statements"));
        return;
      }
      res.json({ statements: data ?? [] });
    }),
  );

  router.post(
    "/:id/seven-day-statements",
    requireOrg,
    canView,
    validateBody(sevenDayStatementCreateSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as SevenDayStatementCreate;

      // Refused FIRST, before the admin client is even constructed, so a rejected write touches no
      // database at all — the same shape `roster/drivers.ts` uses for its lifecycle guard.
      if (!canWriteDriverLifecycle(req.auth!.role)) {
        res
          .status(403)
          .json(apiError("forbidden", "Recording a seven-day statement is a fleet action."));
        return;
      }

      const id = String(req.params.id ?? "");
      if (body.driver_id !== id) {
        // The path names the driver and so does the payload; disagreeing about who this record is
        // about is the kind of mismatch that files a person's hours against somebody else.
        res.status(422).json(apiError("driver_mismatch", "The statement is for a different driver."));
        return;
      }

      const drift = sevenDayWindowMismatch(body);
      if (drift) {
        res.status(422).json(
          apiError(
            "window_mismatch",
            `A statement dated ${body.statement_date} must cover ${drift.expected[0]} to ${drift.expected[6]}.`,
          ),
        );
        return;
      }

      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;

      const { data: driver } = await admin
        .from("drivers")
        .select("id, full_name")
        .eq("id", id)
        .eq("org_id", orgId)
        .maybeSingle();
      if (!driver) {
        res.status(404).json(apiError("not_found", "Driver not found"));
        return;
      }

      const { data, error } = await admin
        .from("seven_day_statements")
        .insert({
          org_id: orgId,
          driver_id: id,
          statement_date: body.statement_date,
          days: body.days,
          last_relieved_at: body.last_relieved_at,
          signed_name: body.signed_name,
          signed_on: body.signed_on,
          recorded_by: req.auth!.userId,
        })
        .select(COLS)
        .single();
      if (error || !data) {
        res.status(500).json(apiError("db_error", "Could not record the statement"));
        return;
      }

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "compliance.seven_day_statement_recorded",
        entity: "seven_day_statements",
        entityId: (data as { id: string }).id,
        // The dates and who signed — never the hours. An audit log an admin can read is not the place
        // for a second copy of somebody's working week.
        meta: {
          driverId: id,
          statementDate: body.statement_date,
          signedOn: body.signed_on,
        },
      });

      res.status(201).json({ statement: data });
    }),
  );

  return router;
}
