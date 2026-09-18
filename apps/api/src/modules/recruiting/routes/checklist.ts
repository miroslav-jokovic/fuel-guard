import { Router } from "express";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { applicantChecklist, isChecklistError } from "../applicantChecklist.js";

/**
 * Where one applicant has got to, across all fourteen steps (B3, `HIRING-MODULE-PLAN.md` §9).
 *
 * ── WHY `view` AND NOT `manage` ────────────────────────────────────────────────────────────────
 * Reading a checklist changes nothing and does what the board exists for: answering *"what is mine
 * today?"*. It is the same call the recruitment section's other reads make — `applicationReview`'s
 * own header says it in as many words, that anybody who can see an applicant can see what was
 * filled in. Every write this checklist reports on is already gated by the route that performs it,
 * at the strength that act deserves; gating the *summary* harder than the acts it summarises would
 * hide the board from the people whose queue it is.
 *
 * ⚠ It carries no §391.21 answers, no date of birth and no licence number — by construction rather
 * than by filtering. `applicantChecklist` reads the existence of rows and a set of record kinds, and
 * `hiringChecklist` returns states, labels and table names. There is nothing here to redact.
 */
export function recruitmentChecklistRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/applicants/:driverId/checklist",
    requireOrg,
    requireSection("recruitment", "view"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await applicantChecklist(
        admin,
        req.auth!.orgId!,
        String(req.params.driverId ?? ""),
      );
      if (isChecklistError(result)) {
        res.status(404).json(apiError(result.code, result.message));
        return;
      }
      res.json({ ok: true, checklist: result });
    }),
  );

  return router;
}
