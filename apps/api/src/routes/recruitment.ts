import { Router } from "express";
import {
  DISCLOSURES,
  authorizationGrantSchema,
  authorizationRevokeSchema,
  employmentCoverage,
  employmentHistoryCreateSchema,
  employmentHistoryUpdateSchema,
  rolesThatCanView,
  rolesThatManage,
  type EmploymentHistoryCreate,
  type AuthorizationGrant,
  type AuthorizationRevoke,
  type EmploymentHistoryUpdate,
  type EmploymentPeriod,
} from "@fuelguard/shared";
import { requireAuth, requireOrg, requireRole } from "../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { writeAudit } from "../lib/audit.js";

/**
 * Recruitment — the §391.21(b)(10) employment list and its §391.23(a)(2) inquiry state (0208).
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

export function recruitmentRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  const canView = requireRole(...rolesThatCanView("recruitment"));
  const canManage = requireRole(...rolesThatManage("recruitment"));

  /**
   * The fleet queue: one row per active driver with what their hiring file looks like.
   *
   * The coverage is computed HERE from the same pure function the driver page calls, never a second
   * SQL approximation of it — the fleet table and the driver page disagreeing about whether somebody
   * has a gap is the failure mode `qualification` already had to design out (D3).
   *
   * `asOf` is the driver's hire date when we have one: §391.21(b)(10)'s window ends at the
   * application, so measuring a five-year employee's history against TODAY would invent three years
   * of gap nobody was ever required to list.
   */
  router.get(
    "/roster",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const today = new Date().toISOString().slice(0, 10);

      const { data: drivers, error: driversError } = await admin
        .from("drivers")
        .select("id, full_name, status, hire_date, date_of_birth")
        .eq("org_id", orgId)
        .neq("status", "terminated")
        .order("full_name", { ascending: true });
      if (driversError) {
        res.status(500).json(apiError("db_error", "Could not list drivers"));
        return;
      }

      const { data: history, error: historyError } = await admin
        .from("driver_employment_history")
        .select(HISTORY_COLS)
        .eq("org_id", orgId);
      if (historyError) {
        res.status(500).json(apiError("db_error", "Could not load employment history"));
        return;
      }

      const byDriver = new Map<string, HistoryRow[]>();
      for (const row of (history ?? []) as HistoryRow[]) {
        const list = byDriver.get(row.driver_id);
        if (list) list.push(row);
        else byDriver.set(row.driver_id, [row]);
      }

      const rows = (drivers ?? []).map((d) => {
        const own = byDriver.get(d.id) ?? [];
        const coverage = employmentCoverage(own.map(toPeriod), d.hire_date ?? today);
        return {
          driver_id: d.id,
          full_name: d.full_name,
          status: d.status,
          hire_date: d.hire_date,
          // The value itself never leaves the roster API — this surface only needs to know whether
          // the driver can be screened at all (PSP-PLAN.md P0), and a date of birth on a fleet-wide
          // list is a personal file printed 200 times over.
          date_of_birth_recorded: Boolean(d.date_of_birth),
          employers: own.length,
          // §391.21(b)(10) and (b)(11) are reported separately, and only the first carries a gap
          // figure: (b)(11) asks for CMV jobs alone, so a stretch without one is somebody who was
          // not driving, not a hole (HIRING-PLAN.md D-HIRE1).
          employers_in_window: coverage.segmentA.employers,
          gap_days: coverage.segmentA.gaps.reduce((sum, g) => sum + g.days, 0),
          cmv_employers: coverage.segmentB.cmvEmployers,
          inquiries_outstanding: coverage.inquiriesOutstanding.length,
          inquiries_awaiting: coverage.inquiriesAwaitingResponse.length,
        };
      });

      res.json({ drivers: rows });
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

  // ── Authorizations (0215, H1) ─────────────────────────────────────────────────────────────────
  //
  // The legal basis for every screening pull. Nothing here is a checkbox: one row is one document,
  // because FCRA §604(b)(2) requires the disclosure to consist SOLELY of the disclosure.

  const AUTH_COLS =
    "id, driver_id, purpose, disclosure_version, disclosure_text, method, signed_name, intent_statement, esign_consent_at, accepted_at, evidence_document_id, revokes, revoke_reason, created_at";

  router.get(
    "/drivers/:driverId/authorizations",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const { data, error } = await admin
        .from("driver_authorizations")
        .select(AUTH_COLS)
        .eq("org_id", req.auth!.orgId!)
        .eq("driver_id", String(req.params.driverId ?? ""))
        .order("accepted_at", { ascending: false });
      if (error) {
        res.status(500).json(apiError("db_error", "Could not load authorizations"));
        return;
      }
      res.json({ authorizations: data ?? [] });
    }),
  );

  router.post(
    "/authorizations",
    requireOrg,
    canManage,
    validateBody(authorizationGrantSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const body = res.locals.body as AuthorizationGrant;

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

      // THE SERVER COMPOSES THE INSTRUMENT. The request carries who signed and how, never what they
      // signed — a client-authored disclosure is worth nothing in an audit, and the contract has no
      // field to send one in. Same rule as `hazmat_reviews.attestation` (0092, D8).
      const doc = DISCLOSURES[body.purpose];

      const { data, error } = await admin
        .from("driver_authorizations")
        .insert({
          org_id: orgId,
          driver_id: body.driver_id,
          purpose: body.purpose,
          disclosure_version: doc.version,
          disclosure_text: doc.body,
          intent_statement: doc.intent,
          method: body.method,
          signed_name: body.signed_name,
          esign_consent_at: body.method === "esign" ? new Date().toISOString() : null,
          // ESIGN attribution evidence. `trust proxy` is set in app.ts, so req.ip is the client's.
          accepted_ip: req.ip ?? null,
          accepted_user_agent: req.get("user-agent") ?? null,
          evidence_document_id: body.evidence_document_id ?? null,
          recorded_by: req.auth!.userId,
        })
        .select(AUTH_COLS)
        .single();
      if (error || !data) {
        res.status(500).json(apiError("db_error", "Could not record the authorization"));
        return;
      }

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "compliance.authorization_recorded",
        entity: "driver_authorizations",
        entityId: data.id,
        // The version, never the text: which instrument was signed is the auditable fact, and the
        // row itself holds the wording. `signed_name` is the driver's name — not copied here.
        meta: {
          driverId: body.driver_id,
          purpose: body.purpose,
          disclosureVersion: doc.version,
          method: body.method,
        },
      });

      res.status(201).json({ authorization: data });
    }),
  );

  /** Revocation is a ROW, not an edit — the table is append-only, and "what did we hold at the
   *  moment we made the request" has to stay answerable. */
  router.post(
    "/authorizations/revoke",
    requireOrg,
    canManage,
    validateBody(authorizationRevokeSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const body = res.locals.body as AuthorizationRevoke;

      const { data: grant } = await admin
        .from("driver_authorizations")
        .select("id, driver_id, purpose, revokes")
        .eq("id", body.revokes)
        .eq("org_id", orgId)
        .maybeSingle();
      if (!grant || grant.revokes !== null) {
        res.status(404).json(apiError("not_found", "Authorization not found"));
        return;
      }

      const doc = DISCLOSURES[grant.purpose as keyof typeof DISCLOSURES];
      const { data, error } = await admin
        .from("driver_authorizations")
        .insert({
          org_id: orgId,
          driver_id: grant.driver_id,
          purpose: grant.purpose,
          // Carried from the grant so the revocation names what was withdrawn, not a newer wording.
          disclosure_version: doc?.version ?? "unknown",
          disclosure_text: "",
          intent_statement: "",
          method: "verbal_documented",
          signed_name: "",
          revokes: grant.id,
          revoke_reason: body.reason,
          recorded_by: req.auth!.userId,
        })
        .select(AUTH_COLS)
        .single();
      if (error || !data) {
        res.status(500).json(apiError("db_error", "Could not record the revocation"));
        return;
      }

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "compliance.authorization_revoked",
        entity: "driver_authorizations",
        entityId: data.id,
        meta: { driverId: grant.driver_id, purpose: grant.purpose, revokes: grant.id },
      });

      res.status(201).json({ authorization: data });
    }),
  );

  return router;
}
