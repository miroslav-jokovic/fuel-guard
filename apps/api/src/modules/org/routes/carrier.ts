import { Router } from "express";
import { z } from "zod";
import { rolesThatCanView, rolesThatManage } from "@silvicom/shared";
import { requireAuth, requireOrg, requireRole } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { getCarrierIdentity, setCarrierIdentity, type CarrierIdentityInput } from "../carrierIdentity.js";

/**
 * `/api/org/carrier` — the carrier's own identity as it appears on filings (0282).
 *
 * Gated on the `settings` section: this is the operations console's data, and R0's ruling was that
 * "may configure the product" is a different question from "may edit the fleet". A `technician` can
 * print a report that carries this address and cannot change it, which is the correct split.
 */

const patchSchema = z.object({
  addressLine1: z.string().max(200).nullish(),
  city: z.string().max(100).nullish(),
  state: z.string().max(20).nullish(),
  postalCode: z.string().max(20).nullish(),
  dotNumber: z.string().max(20).nullish(),
});

export function carrierRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/",
    requireOrg,
    requireRole(...rolesThatCanView("settings")),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await getCarrierIdentity(admin, req.auth!.orgId!);
      if ("code" in result) {
        res.status(500).json(apiError(result.code, result.error));
        return;
      }
      res.json({ ok: true, carrier: result });
    }),
  );

  router.patch(
    "/",
    requireOrg,
    requireRole(...rolesThatManage("settings")),
    validateBody(patchSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const body = res.locals.body as CarrierIdentityInput;
      const result = await setCarrierIdentity(admin, orgId, body);
      if ("code" in result) {
        res.status(500).json(apiError(result.code, result.error));
        return;
      }
      // Audited because this address is printed onto documents a regulator reads, and §396.17(c)(2)
      // makes it the route from a decal on a truck to the file the report sits in.
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "org.carrier_identity_updated",
        entity: "organizations",
        entityId: orgId,
        meta: { fields: Object.keys(body) },
      });
      const after = await getCarrierIdentity(admin, orgId);
      res.json({ ok: true, carrier: "code" in after ? null : after });
    }),
  );

  return router;
}
