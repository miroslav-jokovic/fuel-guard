import type { Router } from "express";
import { z } from "zod";
import { requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { listOfficeMembers, lookupMemberRole } from "../../org/index.js";
import { linkDispatcherUser, linkFleet, readDispatchLinks } from "../dispatchLinks.js";

/**
 * Settings → Integrations → McLeod: whose fleet is whose (DISPATCH-BOARD-PLAN DB2, LM11).
 *
 * ── GATED BY THE SECTION MATRIX, NOT A ROLE LIST ─────────────────────────────────────────────────
 * Q-DB3 ruled "admin and fleet manager link fleets and users" — which is exactly who holds
 * `settings: manage` in the matrix, so the gate is that section and not a hand-written pair of roles
 * (the workaround this repo names). An org that grants settings to another role is answered by its own
 * overrides. Reading the links is `settings: view`, the same as the rest of the integration page.
 *
 * Every write is audited: a link moves a dispatcher's whole board, and "who moved Vinnie's trucks to
 * Asen" must have an answer.
 */
const fleetBody = z.object({ dispatcherId: z.string().trim().min(1).max(64).nullable() });
const userBody = z.object({ userId: z.uuid().nullable() });

export function registerDispatchLinkRoutes(router: Router): void {
  router.get(
    "/mcleod/dispatch-links",
    requireOrg,
    requireSection("settings", "view"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const links = await readDispatchLinks(admin, orgId, req.auth!.userId);
      const people = await listOfficeMembers(admin, orgId);
      res.json({ fleets: links.fleets, dispatchers: links.dispatchers, people });
    }),
  );

  router.put(
    "/mcleod/fleets/:code",
    requireOrg,
    requireSection("settings"),
    asyncHandler(async (req, res) => {
      const parsed = fleetBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(apiError("invalid_payload", parsed.error.issues[0]?.message ?? "invalid payload"));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const code = String(req.params.code ?? "");
      const r = await linkFleet(admin, orgId, code, parsed.data.dispatcherId, req.auth!.userId);
      if (!r.ok) {
        res.status(r.status).json(apiError(r.code, r.message));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "integration.mcleod.fleet_linked",
        entity: "tms_fleets",
        meta: { code, dispatcherId: parsed.data.dispatcherId },
      });
      res.json({ ok: true });
    }),
  );

  router.put(
    "/mcleod/dispatchers/:id/user",
    requireOrg,
    requireSection("settings"),
    asyncHandler(async (req, res) => {
      const parsed = userBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(apiError("invalid_payload", parsed.error.issues[0]?.message ?? "invalid payload"));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const dispatcherId = String(req.params.id ?? "");
      const userId = parsed.data.userId;
      // A link to somebody outside THIS org is refused before it is written (the service role would
      // otherwise store any uuid it was handed).
      if (userId) {
        const member = await lookupMemberRole(admin, orgId, userId);
        if (!member.ok) {
          res.status(member.reason === "not_found" ? 404 : 500).json(apiError("not_a_member", "That person is not a member of this organization"));
          return;
        }
      }
      const r = await linkDispatcherUser(admin, orgId, dispatcherId, userId);
      if (!r.ok) {
        res.status(r.status).json(apiError(r.code, r.message));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "integration.mcleod.dispatcher_linked",
        entity: "tms_dispatchers",
        meta: { dispatcherId, userId },
      });
      res.json({ ok: true });
    }),
  );
}
