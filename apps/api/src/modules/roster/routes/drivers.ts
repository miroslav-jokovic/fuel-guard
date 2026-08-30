import { Router } from "express";
import { randomUUID } from "node:crypto";
import {
  EMPLOYED_DRIVER_STATUSES,
  canWriteDriverLifecycle,
  driverCreateSchema,
  driverInviteSchema,
  driverUpdateSchema,
  deriveFullName,
  touchesDriverLifecycle,
  isEmailDomainAllowed,
  resolveDriverUpdate,
  rolesThatCanView,
  rolesThatManage,
  type DriverCreateRequest,
  type DriverInviteRequest,
  type DriverUpdateContext,
  type DriverUpdateRequest,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireRole } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { deliverInvite } from "../../org/index.js";
import { reconcileDrivers, mergeDriverPair } from "../driverReconcile.js";

/**
 * Driver ROSTER — the admin-owned master-data surface for people (Master Data plan §6, M2 slice).
 *
 * Two things live here and they are not the same thing:
 *   the ROSTER RECORD  — who works here, their CDL, their medical card. Exists with or without a login.
 *   APP ACCESS         — a login bound to that record. `POST /:id/invite` starts it; accepting the
 *                        invite finishes it in routes/invites.ts (0102 / plan §3.2).
 *
 * Before this router there was no way to create a driver at all: every row in `drivers` was
 * auto-created by the Samsara sync or the EFS name matcher. Anything created here is marked
 * `identity_source = 'manual'`, which is the flag the sync reads to stop overwriting admin edits.
 *
 * Gating follows the `fleet` section matrix (packages/shared/src/auth.ts) — the single source of
 * truth the RLS policies in 0097–0101 mirror. Enrolling for app access is narrower than editing
 * master data (admin + fleet_manager only): it hands out a login, not a phone number.
 *
 * DEACTIVATION IS A STATUS EDIT, not its own endpoint. `PATCH { status: 'terminated' }` is the whole
 * mechanism: `auth_driver_id()` (0083) resolves only 'active' drivers, so a non-active roster row
 * stops resolving in the driver app on the next request — no session to revoke, no second code path
 * that can disagree with the first. The roster row itself is never deleted; §391.51(c) retains the
 * qualification file for three years past the end of employment.
 */

/**
 * Roster list columns — what a manager scans a 100-row table by, not the full profile.
 * Kept as ONE string literal (not concatenated): PostgREST's typings parse the select list at the
 * type level, and a concatenation widens to `string`, which collapses the row type to an error union.
 */
const DRIVER_LIST_COLS =
  "id, full_name, status, employee_id, phone, email, driver_type, identity_source, app_access_enabled, user_id, cdl_number, cdl_expires_at, medical_card_expires_at, hire_date, created_at, archived_at";

/** The full profile — every column 0098 added, minus the ones another surface owns (app credentials,
 *  telematics HOS snapshots, the EFS card link). Same one-literal rule as above. */
const DRIVER_DETAIL_COLS =
  "id, full_name, first_name, middle_name, last_name, status, driver_type, employee_id, email, phone, phone_alt, date_of_birth, hire_date, termination_date, address_line1, address_line2, city, state, postal_code, emergency_contact_name, emergency_contact_phone, emergency_contact_relation, cdl_number, cdl_state, cdl_class, cdl_issued_at, cdl_expires_at, cdl_restrictions, medical_card_expires_at, medical_examiner_name, medical_registry_number, pay_type, pay_rate, per_diem, settlement_company, eld_id, identity_source, app_access_enabled, user_id, samsara_driver_id, return_to_duty_required, created_at, updated_at";

/** The compliance-relevant fields, whose BEFORE and AFTER values go into the audit row rather than
 *  just the field name. A DOT auditor asks when a medical card expiry changed and to what; they do
 *  not ask about somebody's home address, and copying every edited value into a log an admin can read
 *  would turn the audit trail into a second, less protected copy of the driver's personal file. */
const AUDITED_VALUE_FIELDS = [
  "status", "termination_date", "cdl_number", "cdl_expires_at", "medical_card_expires_at", "driver_type",
] as const;

export function rosterDriversRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  const canView = requireRole(...rolesThatCanView("roster"));
  /**
   * Create + edit a driver row, which is a RECRUITMENT action as much as a fleet one.
   *
   * An applicant is a `drivers` row — `driver_employment_history.driver_id` references it — so a
   * recruiter cannot work without writing this table. Granting them `fleet: manage` to get there
   * would also hand over vehicles, trailers and terminals through seventeen other policies, which is
   * the leak the `recruitment` section was introduced to close. So the two section role-sets are
   * UNIONED here, by name, on these two routes only, and migration 0212 mirrors it in
   * `drivers_write`. Everything else on this router stays fleet-only, including enrolment for app
   * access (admin + fleet_manager), which hands out a login.
   */
  const canWriteDriver = requireRole(
    ...new Set([...rolesThatManage("roster"), ...rolesThatManage("recruitment")]),
  );

  // List the org's drivers (managers + dispatch/audit read).
  router.get(
    "/",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      // The employed roster. An applicant is a drivers row (D-HIRE5) but not somebody the fleet
      // manages yet; Recruitment lists them until they are hired.
      const showArchived = String(req.query.archived ?? "") === "true";
      const { data, error } = await admin
        .from("drivers")
        .select(DRIVER_LIST_COLS)
        .eq("org_id", req.auth!.orgId!)
        .in("status", [...EMPLOYED_DRIVER_STATUSES])
        // Archived rows leave the ROSTER and nothing else (0235). `?archived=true` is the other half
        // of the same list rather than a second endpoint — the "Archived" chip is a filter over one
        // set of people, and splitting it would let the two views drift in columns or ordering.
        .filter("archived_at", showArchived ? "not.is" : "is", null)
        .order("full_name", { ascending: true });
      if (error) {
        res.status(500).json(apiError("db_error", "Could not list drivers"));
        return;
      }
      res.json({ drivers: data ?? [] });
    }),
  );

  // Create a roster driver — the fleet managers, plus the recruiter (see canWriteDriver).
  router.post(
    "/",
    requireOrg,
    canWriteDriver,
    validateBody(driverCreateSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const body = res.locals.body as DriverCreateRequest;

      // `full_name` is NOT NULL and is what the Samsara matcher and every existing surface reads, so
      // derive it when the admin filled only the structured parts. The contract guarantees one or the
      // other is present.
      const fullName = body.full_name?.trim() || deriveFullName(body);

      const { full_name: _ignored, ...rest } = body;
      const { data, error } = await admin
        .from("drivers")
        .insert({
          ...rest,
          org_id: orgId,
          full_name: fullName,
          // Never client-supplied: this row is admin-owned, so telematics must not overwrite its
          // identity fields on the next sync (plan §4).
          identity_source: "manual",
        })
        .select(DRIVER_LIST_COLS)
        .single();

      if (error || !data) {
        res.status(500).json(apiError("db_error", "Could not create driver"));
        return;
      }

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "driver.created",
        entity: "drivers",
        entityId: data.id as string,
        meta: { fullName },
      });

      res.status(201).json({ driver: data });
    }),
  );

  // The full profile behind one roster row (managers + dispatch/audit read).
  router.get(
    "/:id",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const { data, error } = await admin
        .from("drivers")
        .select(DRIVER_DETAIL_COLS)
        .eq("id", String(req.params.id ?? ""))
        // Tenant scope on the query, not on the result: a cross-org id must be indistinguishable
        // from one that does not exist.
        .eq("org_id", req.auth!.orgId!)
        .maybeSingle();
      if (error) {
        res.status(500).json(apiError("db_error", "Could not load driver"));
        return;
      }
      if (!data) {
        res.status(404).json(apiError("not_found", "Driver not found"));
        return;
      }
      res.json({ driver: data });
    }),
  );

  // Edit master data (admin/fleet_manager/safety_manager). Before this existed, every column 0098
  // added was write-once: a driver created with a mistyped CDL expiry stayed that way forever.
  router.patch(
    "/:id",
    requireOrg,
    canWriteDriver,
    validateBody(driverUpdateSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as DriverUpdateRequest;

      // A recruiter edits the applicant's row but does not move them through their employment
      // lifecycle: `status` and `termination_date` start the §391.51(c) retention clock and end the
      // driver's app access (auth_driver_id() resolves only `active` rows). Refused FIRST — before
      // the admin client is even constructed, so a rejected edit touches no database at all — and
      // refused on the FIELD rather than on the value `terminated`, so un-terminating is closed with
      // it. Migration 0213 mirrors this on the PostgREST path, which the service role here bypasses.
      if (touchesDriverLifecycle(body) && !canWriteDriverLifecycle(req.auth!.role)) {
        res
          .status(403)
          .json(apiError("forbidden", "Changing a driver's employment status is a fleet action."));
        return;
      }

      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const id = String(req.params.id ?? "");

      // Read first: what an edit MEANS depends on the row's current state — whether telematics owns
      // it, whether a termination date already exists, what the untouched name parts are.
      const { data: current } = await admin
        .from("drivers")
        .select("id, identity_source, termination_date, first_name, middle_name, last_name")
        .eq("id", id)
        .eq("org_id", orgId)
        .maybeSingle();
      if (!current) {
        res.status(404).json(apiError("not_found", "Driver not found"));
        return;
      }

      const resolved = resolveDriverUpdate(
        body,
        current as unknown as DriverUpdateContext,
        new Date().toISOString().slice(0, 10),
      );

      const { data, error } = await admin
        .from("drivers")
        .update(resolved.patch)
        .eq("id", id)
        .eq("org_id", orgId)
        .select(DRIVER_DETAIL_COLS)
        .single();
      if (error || !data) {
        res.status(500).json(apiError("db_error", "Could not update driver"));
        return;
      }

      const changed: Record<string, unknown> = {};
      for (const f of AUDITED_VALUE_FIELDS) {
        if (f in body) changed[f] = (body as Record<string, unknown>)[f];
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "driver.updated",
        entity: "drivers",
        entityId: id,
        meta: {
          fields: Object.keys(body).sort(),
          changed,
          claimedFromTelematics: resolved.claimedFromTelematics,
          stampedTerminationDate: resolved.stampedTerminationDate,
        },
      });

      res.json({ driver: data });
    }),
  );

  // Enroll an EXISTING roster driver for driver-app access (admin/fleet_manager).
  // The invite carries `driver_id`; acceptance binds `drivers.user_id` (routes/invites.ts, plan §3.2).
  // ⚠ Narrower than `rolesThatManage("roster")` on purpose — see rosterCredentialsRouter's header.
  // An invitation is the first half of issuing a credential, so it carries the same gate.
  router.post(
    "/:id/invite",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    validateBody(driverInviteSchema),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const id = String(req.params.id ?? "");
      const { email } = res.locals.body as DriverInviteRequest;

      const { data: driver } = await admin
        .from("drivers")
        .select("id, user_id, full_name")
        .eq("id", id)
        .eq("org_id", orgId)
        .maybeSingle();
      if (!driver) {
        res.status(404).json(apiError("not_found", "Driver not found"));
        return;
      }
      // One login ↔ one driver (idx_drivers_user, 0098). Re-linking is an explicit unlink, not a
      // silent overwrite — otherwise a typo'd invite could move a driver's app to someone else.
      if (driver.user_id) {
        res.status(409).json(apiError("already_linked", "This driver already has app access"));
        return;
      }

      const { data: org } = await admin
        .from("organizations")
        .select("name, allowed_domains")
        .eq("id", orgId)
        .single();
      if (!org || !isEmailDomainAllowed(email, (org.allowed_domains ?? []) as string[])) {
        res
          .status(422)
          .json(
            apiError("domain_not_allowed", "Email domain is not allowed for this organization"),
          );
        return;
      }

      const token = `${randomUUID()}${randomUUID()}`;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      // Upsert on the table's (org_id, email) unique key: re-inviting the same address re-points and
      // re-arms the invite instead of 409-ing, which is what an admin means by "send it again".
      const { error: inviteErr } = await admin.from("invites").upsert(
        {
          org_id: orgId,
          email,
          role: "driver",
          driver_id: id,
          invited_by: req.auth!.userId,
          token,
          expires_at: expiresAt.toISOString(),
          status: "pending",
        },
        { onConflict: "org_id,email" },
      );
      if (inviteErr) {
        res.status(500).json(apiError("db_error", "Could not create invite"));
        return;
      }

      const delivery = await deliverInvite(admin, env, (org.name as string) ?? "Silvicom 360", email);
      if (!delivery.sent)
        console.error(`[roster] driver invite not sent for ${email} (${delivery.reason})`);

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "driver.invited",
        entity: "drivers",
        entityId: id,
        meta: { email, emailSent: delivery.sent, reason: delivery.reason },
      });

      res.json({
        ok: true,
        emailSent: delivery.sent,
        reason: delivery.reason,
        link: delivery.link,
      });
    }),
  );

  // Reconcile duplicate / name-only drivers: fold each unmatched (no Samsara id) driver into its Samsara
  // twin. DRY RUN by default (returns the exact merge pairs to review); { apply: true } executes them via
  // the atomic merge_driver() function. Admin/fleet-manager only.
  //
  // ⚠ Narrower than `rolesThatManage("roster")` on purpose, and this is the one where it matters most:
  // a merge moves every fuel, idle, HOS and qualification row off one driver onto another and there is
  // no un-merge. The D-ROS12 split must not widen it to `safety_manager` as a side effect of a rename;
  // if that grant is ever wanted it is a decision somebody makes on its own, in writing.
  router.post(
    "/reconcile",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const apply = (req.body as { apply?: unknown } | undefined)?.apply === true;
      const result = await reconcileDrivers(admin, orgId, { apply });
      // H8's honesty rule applied to a sweep: the audit row says what was merged AND what was refused.
      // A dedup that quietly folded 8 of 10 pairs and logged "8" reads as a complete pass.
      if (apply && (result.merged > 0 || result.skipped.length > 0)) {
        await writeAudit(admin, {
          orgId, actorId: req.auth!.userId, action: "driver.reconciled", entity: "drivers",
          meta: { merged: result.merged, planned: result.planned, skipped: result.skipped.length },
        });
      }
      res.json(result);
    }),
  );

  // Manually link an unmatched driver to a Samsara driver — folds :id (source) INTO { canonicalId }.
  // For the residual single-name cases the auto-reconcile won't touch. Admin/fleet-manager only.
  // ⚠ Narrower than the section for the same reason /reconcile is — it is the same irreversible act,
  // performed one pair at a time.
  router.post(
    "/:id/merge",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const sourceId = String(req.params.id ?? "");
      const canonicalId = String((req.body as { canonicalId?: unknown } | undefined)?.canonicalId ?? "");
      if (!canonicalId) {
        res.status(422).json(apiError("bad_request", "canonicalId is required"));
        return;
      }
      try {
        await mergeDriverPair(admin, orgId, sourceId, canonicalId);
      } catch (e) {
        res.status(422).json(apiError("merge_failed", e instanceof Error ? e.message : "merge failed"));
        return;
      }
      await writeAudit(admin, {
        orgId, actorId: req.auth!.userId, action: "driver.merged", entity: "drivers", entityId: canonicalId,
        meta: { source: sourceId, canonical: canonicalId },
      });
      res.json({ ok: true });
    }),
  );

  return router;
}
