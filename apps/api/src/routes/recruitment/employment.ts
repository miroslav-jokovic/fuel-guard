import { Router } from "express";
import {
  applicantProgress,
  currentDisposition,
  employmentCoverage,
  employmentHistoryCreateSchema,
  employmentHistoryUpdateSchema,
  rolesThatCanView,
  rolesThatManage,
  type ApplicantDispositionRow,
  type EmploymentHistoryCreate,
  type AuthorizationRow,
  type EmploymentHistoryUpdate,
  type EmploymentPeriod,
} from "@fuelguard/shared";
import { requireAuth, requireOrg, requireRole } from "../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../lib/appLocals.js";
import { writeAudit } from "../../lib/audit.js";

/**
 * Recruitment — the applicant pipeline (H6) and the §391.21(b)(10)-(11) employment list (0208).
 *
 * `recruitment` is its OWN section in the capability matrix (`packages/shared/src/auth.ts`), so these
 * guards are derived from it rather than borrowed from `fleet`. That boundary is the point: gated on
 * `fleet` — which is how this first shipped — a dispatcher could read every driver's former
 * employers and their contact details, and §391.53(a)(1) puts the investigation history with "those
 * who are involved in the hiring decision".
 *
 * THE API READS WITH THE SERVICE ROLE, WHICH BYPASSES RLS. Every query here filters `org_id` itself
 * and the tests assert it via `supabaseRecorder`'s `expectOrgScoped`. The policies in 0208 are
 * defence in depth for the PostgREST path, not the enforcement on this one.
 */

const HISTORY_COLS =
  "id, driver_id, employer_name, usdot_number, employer_city, employer_state, employer_phone, employer_email, position_held, started_on, ended_on, dot_regulated, operated_cmv, subject_to_fmcsr, safety_sensitive, reason_for_leaving, inquiry_status, inquiry_sent_on, inquiry_response_on, source, notes, created_at, updated_at";

interface HistoryRow {
  id: string;
  driver_id: string;
  employer_name: string;
  started_on: string;
  ended_on: string | null;
  dot_regulated: boolean;
  operated_cmv: boolean | null;
  inquiry_status: string;
}

/** The shape `employmentCoverage` judges — the DB row minus everything the arithmetic ignores. */
const toPeriod = (r: HistoryRow): EmploymentPeriod => ({
  id: r.id,
  employerName: r.employer_name,
  startedOn: r.started_on,
  endedOn: r.ended_on,
  dotRegulated: r.dot_regulated,
  operatedCmv: r.operated_cmv,
  inquiryStatus: r.inquiry_status as EmploymentPeriod["inquiryStatus"],
});

export function recruitmentEmploymentRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  const canView = requireRole(...rolesThatCanView("recruitment"));
  const canManage = requireRole(...rolesThatManage("recruitment"));

  /**
   * The APPLICANT pipeline — who is waiting on what (H6).
   *
   * This replaced a fleet table of every driver with their gaps and inquiry state, which restated
   * what the qualification page already owns. The boundary that fixes it is D-HIRE2: Recruitment
   * owns the APPLICANT, DQF owns the DRIVER. Once this lists applicants, the two surfaces are not
   * looking at the same people and the duplication has nowhere to come from.
   *
   * Employment history for somebody already hired is still reachable — on their own driver page,
   * where it belongs, rather than in a second fleet-wide table here.
   *
   * The stage is computed by the SAME pure function the page would call, never a second SQL
   * approximation of it: a pipeline that disagrees with the file it summarises is worse than no
   * pipeline. `asOf` is the application date when we have one, which for now is the row's creation.
   */
  router.get(
    "/pipeline",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;

      // Archived applicants leave the board and nothing else (0235): their row, their draft and
      // anything they signed are untouched and their own page still opens. `?archived=true` is the
      // other half of the same list — the "Archived" chip — rather than a second endpoint.
      const showArchived = String(req.query.archived ?? "") === "true";
      const { data: applicants, error: applicantsError } = await admin
        .from("drivers")
        .select("id, full_name, status, hire_date, date_of_birth, created_at, archived_at")
        .eq("org_id", orgId)
        .eq("status", "applicant")
        .filter("archived_at", showArchived ? "not.is" : "is", null)
        .order("created_at", { ascending: true });
      if (applicantsError) {
        res.status(500).json(apiError("db_error", "Could not list applicants"));
        return;
      }

      const ids = (applicants ?? []).map((a) => a.id);
      if (ids.length === 0) {
        res.json({ applicants: [] });
        return;
      }

      const [history, auths, decisions] = await Promise.all([
        admin
          .from("driver_employment_history")
          .select(HISTORY_COLS)
          .eq("org_id", orgId)
          .in("driver_id", ids),
        admin
          .from("driver_authorizations")
          .select("id, driver_id, purpose, accepted_at, revokes")
          .eq("org_id", orgId)
          .in("driver_id", ids),
        // 0238. A decided applicant stays on the board — they are still `status = applicant`, and
        // clearing them off it is what ARCHIVING is for (0235), which is a different act. What the
        // board owes the recruiter is that the decision is VISIBLE, so nobody chases somebody the
        // carrier already turned down.
        admin
          .from("applicant_dispositions")
          .select("id, driver_id, outcome, decided_on, reason, rested_on_consumer_report, decided_by, created_at")
          .eq("org_id", orgId)
          .in("driver_id", ids),
      ]);
      if (history.error || auths.error || decisions.error) {
        res.status(500).json(apiError("db_error", "Could not load the pipeline"));
        return;
      }

      const historyBy = new Map<string, HistoryRow[]>();
      for (const row of (history.data ?? []) as HistoryRow[]) {
        const list = historyBy.get(row.driver_id);
        if (list) list.push(row);
        else historyBy.set(row.driver_id, [row]);
      }
      const decisionsBy = new Map<string, ApplicantDispositionRow[]>();
      for (const row of (decisions.data ?? []) as ApplicantDispositionRow[]) {
        const list = decisionsBy.get(row.driver_id);
        if (list) list.push(row);
        else decisionsBy.set(row.driver_id, [row]);
      }
      const authsBy = new Map<string, AuthorizationRow[]>();
      for (const row of (auths.data ?? []) as Array<AuthorizationRow & { driver_id: string }>) {
        const list = authsBy.get(row.driver_id);
        if (list) list.push(row);
        else authsBy.set(row.driver_id, [row]);
      }

      const rows = (applicants ?? []).map((a) => {
        const own = historyBy.get(a.id) ?? [];
        const asOf = String(a.created_at ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10);
        const coverage = employmentCoverage(own.map(toPeriod), asOf);
        // Segment A only. §391.21(b)(11) asks for CMV jobs alone, so a stretch without one is
        // somebody who was not driving, and a pipeline that chased it would chase every applicant.
        const gapDays = coverage.segmentA.gaps.reduce((sum, g) => sum + g.days, 0);
        const progress = applicantProgress({
          employerCount: own.length,
          gapDays,
          authorizations: authsBy.get(a.id) ?? [],
        });
        return {
          driver_id: a.id,
          full_name: a.full_name,
          applied_on: asOf,
          // Whether they can be screened at all — the value never leaves the roster API.
          date_of_birth_recorded: Boolean(a.date_of_birth),
          employers: own.length,
          employers_in_window: coverage.segmentA.employers,
          cmv_employers: coverage.segmentB.cmvEmployers,
          gap_days: gapDays,
          stage: progress.stage,
          outstanding: progress.outstanding,
          releases_complete: progress.releasesComplete,
          // ⚠ The NEWEST decision, not the first: the table is append-only, so a carrier who
          // declines and then changes its mind records a second row. `currentDisposition` is shared
          // with the driver page so the board and the file cannot answer this differently.
          disposition: currentDisposition(decisionsBy.get(a.id) ?? []),
        };
      });

      res.json({ applicants: rows });
    }),
  );

  /** One driver's declared employment, newest first — the order an application lists it. */
  router.get(
    "/drivers/:driverId/employment",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const { data, error } = await admin
        .from("driver_employment_history")
        .select(HISTORY_COLS)
        .eq("org_id", req.auth!.orgId!)
        .eq("driver_id", String(req.params.driverId ?? ""))
        .order("started_on", { ascending: false });
      if (error) {
        res.status(500).json(apiError("db_error", "Could not load employment history"));
        return;
      }
      res.json({ history: data ?? [] });
    }),
  );

  router.post(
    "/employment",
    requireOrg,
    canManage,
    validateBody(employmentHistoryCreateSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const body = res.locals.body as EmploymentHistoryCreate;

      // The driver must be OURS. Without this the org filter on the insert would still hold, but the
      // row would hang off a driver id from another tenant — org-scoped and nonsensical.
      const { data: driver } = await admin
        .from("drivers")
        .select("id")
        .eq("id", body.driver_id)
        .eq("org_id", orgId)
        .maybeSingle();
      if (!driver) {
        res.status(404).json(apiError("not_found", "Driver not found"));
        return;
      }

      const { data, error } = await admin
        .from("driver_employment_history")
        .insert({ ...body, org_id: orgId, created_by: req.auth!.userId })
        .select(HISTORY_COLS)
        .single();
      if (error || !data) {
        res.status(500).json(apiError("db_error", "Could not record the employer"));
        return;
      }

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "compliance.employment_recorded",
        entity: "driver_employment_history",
        entityId: data.id,
        // The employer's name and dates are the compliance-relevant facts — an auditor asks which
        // employer was added and for what period. The driver's own contact details are not copied.
        meta: {
          driverId: body.driver_id,
          employer: body.employer_name,
          usdotNumber: body.usdot_number ?? null,
          startedOn: body.started_on,
          endedOn: body.ended_on ?? null,
          source: body.source,
        },
      });

      res.status(201).json({ employment: data });
    }),
  );

  router.patch(
    "/employment/:id",
    requireOrg,
    canManage,
    validateBody(employmentHistoryUpdateSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const id = String(req.params.id ?? "");
      const body = res.locals.body as EmploymentHistoryUpdate;

      const { data, error } = await admin
        .from("driver_employment_history")
        .update({ ...body, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("org_id", orgId)
        .select(HISTORY_COLS)
        .maybeSingle();
      if (error) {
        res.status(500).json(apiError("db_error", "Could not update the employer"));
        return;
      }
      if (!data) {
        res.status(404).json(apiError("not_found", "Employment record not found"));
        return;
      }

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "compliance.employment_updated",
        entity: "driver_employment_history",
        entityId: id,
        meta: { fields: Object.keys(body).sort(), inquiryStatus: body.inquiry_status ?? null },
      });

      res.json({ employment: data });
    }),
  );

  /**
   * Delete — allowed, and it is the difference between this table and the evidence tables.
   *
   * A row here is a TRANSCRIPTION of the application, so an employer entered against the wrong driver
   * is a mistake to remove, not a fact to preserve. The evidence itself — the application PDF and the
   * §391.23 inquiry records — is append-only and untouched by this, and the audit row records the
   * removal, so what was deleted and by whom stays answerable.
   */
  router.delete(
    "/employment/:id",
    requireOrg,
    canManage,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const id = String(req.params.id ?? "");

      const { data, error } = await admin
        .from("driver_employment_history")
        .delete()
        .eq("id", id)
        .eq("org_id", orgId)
        .select("id, driver_id, employer_name, started_on, ended_on")
        .maybeSingle();
      if (error) {
        res.status(500).json(apiError("db_error", "Could not remove the employer"));
        return;
      }
      if (!data) {
        res.status(404).json(apiError("not_found", "Employment record not found"));
        return;
      }

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "compliance.employment_removed",
        entity: "driver_employment_history",
        entityId: id,
        meta: {
          driverId: data.driver_id,
          employer: data.employer_name,
          startedOn: data.started_on,
          endedOn: data.ended_on,
        },
      });

      res.json({ ok: true });
    }),
  );

  return router;
}
