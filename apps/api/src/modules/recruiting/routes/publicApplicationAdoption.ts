import { Router } from "express";
import { signatureAdoptionRequestSchema, type SignatureAdoptionRequest } from "@silvicom/shared";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { isIntakeError } from "../applicationIntake.js";
import { recordSignatureAdoption } from "../signatureAdoption.js";

/**
 * `POST /:token/adoption` — screen 13, "Adopt your signature and initials" (APPLICATION-FLOW-V2-PLAN.md
 * §6.2, D-AW15, C3s1). One request per kind; the writer and its rules are `signatureAdoption.ts`.
 *
 * Mounted at the public router's root like the capture routes, so it answers at
 * `/api/public/application/:token/adoption` and sits in the intake's rate bucket: two requests, once per
 * link, are not a ceremony's worth. Its body parser is the one exception to the general 1 MB cap
 * (`appHttp.ts`), because the picture travels in it.
 */
function adoptionStatus(code: string): number {
  if (code === "invalid_link") return 404;
  if (code === "esign_consent_required" || code === "intake_incomplete" || code === "adoption_in_use") return 409;
  // The link and the state are fine; the picture is not. The driver makes it again.
  if (code === "adoption_not_png") return 422;
  return 500;
}

export function publicApplicationAdoptionRouter(): Router {
  const router = Router();

  router.post(
    "/:token/adoption",
    validateBody(signatureAdoptionRequestSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await recordSignatureAdoption(
        admin,
        String(req.params.token ?? ""),
        res.locals.body as SignatureAdoptionRequest,
        { ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null },
        new Date(),
      );
      if (isIntakeError(result)) {
        res.status(adoptionStatus(result.code)).json(apiError(result.code, result.message));
        return;
      }
      res.status(201).json({ ok: true, ...result });
    }),
  );

  return router;
}
