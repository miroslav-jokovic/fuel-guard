import { Router } from "express";
import {
  authorizationGrantSchema,
  isDraftDisclosure,
  authorizationRevokeSchema,
  hiringEvidenceUploadSchema,
  todayInZone,
  type AuthorizationGrant,
  type AuthorizationRevoke,
  type HiringEvidenceUpload,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { loadCarrierWording } from "../carrierWording.js";
import { carrierZone } from "../carrierClock.js";
import {
  isPaperAuthorizationError,
  paperScanRefusal,
  registerPaperAuthorizationScan,
} from "../paperAuthorization.js";

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

  const canView = requireSection("recruitment", "view");
  const canManage = requireSection("recruitment");

  //
  // The legal basis for every screening pull. Nothing here is a checkbox: one row is one document,
  // because FCRA §604(b)(2) requires the disclosure to consist SOLELY of the disclosure.

  const AUTH_COLS =
    "id, driver_id, purpose, disclosure_version, disclosure_text, method, signed_name, intent_statement, esign_consent_at, accepted_at, evidence_document_id, signed_on, revokes, revoke_reason, created_at";

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

  /**
   * Register the scan of a permission signed on paper (MV3), before the grant that cites it — the
   * order every document path in this product uses. No audit, for `/records/:step/document`'s reason:
   * a registration is an intent, and the grant below is the act.
   */
  router.post(
    "/drivers/:driverId/authorizations/document",
    requireOrg,
    canManage,
    validateBody(hiringEvidenceUploadSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await registerPaperAuthorizationScan(
        admin,
        req.auth!.orgId!,
        req.auth!.userId,
        String(req.params.driverId ?? ""),
        res.locals.body as HiringEvidenceUpload,
      );
      if (isPaperAuthorizationError(result)) {
        res
          .status(result.code === "not_found" ? 404 : result.code === "invalid_request" ? 400 : 500)
          .json(apiError(result.code, result.message));
        return;
      }
      res.status(201).json(result);
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

      // MV3: a paper signature carries its scan, and the scan is this driver's (`paperAuthorization.ts`).
      const scan = await paperScanRefusal(admin, orgId, body.driver_id, body.method, body.evidence_document_id);
      if (scan) {
        res.status(scan.code === "not_found" ? 404 : 400).json(apiError(scan.code, scan.message));
        return;
      }

      // G-9: the day on the paper cannot be after today on the carrier's calendar — a future date is a
      // typing mistake, and the file would claim a permission existed before it did.
      if (body.signed_on !== undefined && body.signed_on > todayInZone(new Date(), await carrierZone(admin, orgId))) {
        res.status(400).json(apiError("invalid_request", "The day it was signed cannot be in the future."));
        return;
      }

      // THE SERVER COMPOSES THE INSTRUMENT. The request carries who signed and how, never what they
      // signed — a client-authored disclosure is worth nothing in an audit, and the contract has no
      // field to send one in. Same rule as `hazmat_reviews.attestation` (0092, D8).
      //
      // ⚠ From the CARRIER's published wording (0338), not from the code catalogue. It read
      // `DISCLOSURES[body.purpose]` until 2026-09-13, which was invisibly correct while no carrier
      // had published anything and wrong the moment one did: the applicant's own signature would
      // carry `v1` and this one — the same instrument, the same carrier, recorded by the office
      // because the driver signed on paper — would carry the `v0-draft` placeholder. One driver's
      // file, two texts, and no way to tell afterwards which the driver actually read.
      //
      // Unpublished instruments still fall back to the placeholder, so nothing changes for a
      // carrier that has published nothing.
      //
      // ⚠ G-9 (Q-AW15's default, APPLICATION-FLOW-V2-PLAN.md §11): placeholder wording is now refused
      // here as it is on the applicant's link. A paper signature recorded against `v0-draft` text files
      // a permission for words nobody reviewed — the policy question this comment used to leave open.
      const doc = (await loadCarrierWording(admin, orgId)).disclosures[body.purpose];
      if (isDraftDisclosure(doc.version)) {
        res.status(409).json(apiError(
          "disclosure_not_final",
          "This permission is still draft wording, so a signature on it cannot be recorded. Publish the reviewed text first.",
        ));
        return;
      }

      // A-7: the grant belongs to the applicant's LIVE application link, as the link's own signatures
      // do. Without it the link kept asking for a permission the office had recorded, the filed
      // permissions left it out, and only the driver-keyed checklist counted it. No link (a roster
      // driver) → null, as before.
      const { data: live } = await admin
        .from("application_invitations")
        .select("id")
        .eq("org_id", orgId)
        .eq("driver_id", body.driver_id)
        .is("revoked_at", null)
        .order("created_at", { ascending: false })
        .limit(1);
      const invitationId = ((live ?? []) as Array<{ id: string }>)[0]?.id ?? null;

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
          invitation_id: invitationId,
          esign_consent_at: body.method === "esign" ? new Date().toISOString() : null,
          // ESIGN attribution evidence. `trust proxy` is set in app.ts, so req.ip is the client's.
          // ⚠ A-7: only for an electronic signature. On paper the request comes from the OFFICE's
          // browser, and recording its address as the signer's attribution put the recruiter's
          // network on the driver's signature.
          accepted_ip: body.method === "esign" ? (req.ip ?? null) : null,
          accepted_user_agent: body.method === "esign" ? (req.get("user-agent") ?? null) : null,
          evidence_document_id: body.evidence_document_id ?? null,
          signed_on: body.signed_on ?? null,
          recorded_by: req.auth!.userId,
        })
        .select(AUTH_COLS)
        .single();
      // A-7: `uq_driver_authorizations_invitation_purpose` (0228) — one live grant per purpose per link.
      // ⚠ It covers `revokes is null` rows, so a re-grant after a revocation on the same link lands
      // here too; the words say what to do rather than a 500 saying nothing.
      if (error?.code === "23505") {
        res.status(409).json(apiError(
          "already_granted_on_link",
          "This permission is already on file for the applicant's current application link. "
          + "If it was revoked, send them a new application link to sign it again.",
        ));
        return;
      }
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
          signedOn: body.signed_on ?? null,
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
        .select("id, driver_id, purpose, revokes, disclosure_version")
        .eq("id", body.revokes)
        .eq("org_id", orgId)
        .maybeSingle();
      if (!grant || grant.revokes !== null) {
        res.status(404).json(apiError("not_found", "Authorization not found"));
        return;
      }

      const { data, error } = await admin
        .from("driver_authorizations")
        .insert({
          org_id: orgId,
          driver_id: grant.driver_id,
          purpose: grant.purpose,
          // Carried from the grant so the revocation names what was withdrawn, not a newer wording.
          //
          // ⚠ It now does what that sentence says. Until 2026-09-13 it read the CODE catalogue's
          // current version for the purpose — which is the newer wording, and is the one thing the
          // comment ruled out. Both were `v0-draft` so nothing could show it; once a carrier
          // publishes (0338), revoking a `v1` grant would have filed the revocation against
          // `v0-draft` and the append-only history would no longer join up.
          disclosure_version: grant.disclosure_version ?? "unknown",
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
