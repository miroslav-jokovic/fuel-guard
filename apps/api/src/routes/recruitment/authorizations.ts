import { Router } from "express";
import {
  DISCLOSURES,
  authorizationGrantSchema,
  authorizationRevokeSchema,
  rolesThatCanView,
  rolesThatManage,
  type AuthorizationGrant,
  type AuthorizationRevoke,
} from "@fuelguard/shared";
import { requireAuth, requireOrg, requireRole } from "../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../lib/appLocals.js";
import { writeAudit } from "../../lib/audit.js";

/**
 * Driver authorizations (0215, H1) — the legal basis for every screening pull.
 *
 * Split from `employment.ts` when that file reached the 500-line budget, on the same axis
 * `routes/roster/` uses: one router per subject, both mounted on the prefix. The two are separate
 * subjects anyway — an employment list is what the applicant declared, an authorization is what they
 * signed, and only the second one is what a vendor call has to check before it may be made.
 *
 * Gated on `recruitment`, like its sibling, and the service role means every query org-filters
 * itself (see employment.ts's header).
 */
export function recruitmentAuthorizationsRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  const canView = requireRole(...rolesThatCanView("recruitment"));
  const canManage = requireRole(...rolesThatManage("recruitment"));

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
