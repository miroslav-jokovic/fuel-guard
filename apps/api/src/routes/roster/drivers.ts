import { Router } from "express";
import { randomUUID } from "node:crypto";
import {
  driverCreateSchema,
  driverInviteSchema,
  deriveFullName,
  isEmailDomainAllowed,
  rolesThatCanView,
  rolesThatManage,
  type DriverCreateRequest,
  type DriverInviteRequest,
} from "@fuelguard/shared";
import { requireAuth, requireOrg, requireRole } from "../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../lib/appLocals.js";
import { writeAudit } from "../../lib/audit.js";
import { deliverInvite } from "../invites.js";
import { reconcileDrivers, mergeDriverPair } from "../../services/driverReconcile.js";

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
 * M3 adds detail/update/endorsements/deactivate on this same router.
 */

/**
 * Roster list columns — what a manager scans a 100-row table by, not the full profile.
 * Kept as ONE string literal (not concatenated): PostgREST's typings parse the select list at the
 * type level, and a concatenation widens to `string`, which collapses the row type to an error union.
 */
const DRIVER_LIST_COLS =
  "id, full_name, status, employee_id, phone, email, driver_type, identity_source, app_access_enabled, user_id, cdl_number, cdl_expires_at, medical_card_expires_at, home_terminal_id, hire_date, created_at";

export function rosterDriversRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  const canView = requireRole(...rolesThatCanView("fleet"));
  const canManage = requireRole(...rolesThatManage("fleet"));

  // List the org's drivers (managers + dispatch/audit read).
  router.get(
    "/",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const { data, error } = await admin
        .from("drivers")
        .select(DRIVER_LIST_COLS)
        .eq("org_id", req.auth!.orgId!)
        .order("full_name", { ascending: true });
      if (error) {
        res.status(500).json(apiError("db_error", "Could not list drivers"));
        return;
      }
      res.json({ drivers: data ?? [] });
    }),
  );

  // Create a roster driver (admin/fleet_manager/safety_manager).
  router.post(
    "/",
    requireOrg,
    canManage,
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

  // Enroll an EXISTING roster driver for driver-app access (admin/fleet_manager).
  // The invite carries `driver_id`; acceptance binds `drivers.user_id` (routes/invites.ts, plan §3.2).
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

      const delivery = await deliverInvite(admin, env, (org.name as string) ?? "FuelGuard", email);
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
      if (apply && result.merged > 0) {
        await writeAudit(admin, {
          orgId, actorId: req.auth!.userId, action: "driver.reconciled", entity: "drivers",
          meta: { merged: result.merged, planned: result.planned },
        });
      }
      res.json(result);
    }),
  );

  // Manually link an unmatched driver to a Samsara driver — folds :id (source) INTO { canonicalId }.
  // For the residual single-name cases the auto-reconcile won't touch. Admin/fleet-manager only.
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
