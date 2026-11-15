import type { Request, Response, Router } from "express";
import { adsPlanApprovalSchema, adsPlanEditSchema, isRecordId, planFindingWords, type AdsCampaignPlanRead, type AppSection } from "@silvicom/shared";
import { requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { approvePlan, readPlan, savePlanEdit } from "../plan/planDoors.js";
import type { Actor } from "../settings/settingsVersions.js";

/**
 * `/api/ads/campaigns/:campaignId/plan` (ADS-PLATFORM-V2-PLAN V2c): the plan a campaign's ads are made from.
 *   read      anyone who can VIEW the brief's section, like the campaign itself.
 *   edit      anyone who MANAGES it. An edit is a new version (the table is append-only); it spends nothing.
 *   approve   anyone who MANAGES it. Approving a plan starts the composing step, which runs inside the AI and
 *             render budgets like regenerate does; money moves only at an approver's Launch (`ads.spend`).
 * The refusals are sentences for the person on the review screen; a refused edit also carries each finding.
 */
export interface PlanRouteDeps {
  section: AppSection;
  actorOf: (req: Request) => Promise<Actor>;
}

const MOVED = "The plan changed while you were looking. Reload to read the newest version.";

const campaignId = (req: Request, res: Response): string | null => {
  const id = String(req.params.campaignId);
  if (isRecordId(id)) return id;
  res.status(400).json(apiError("bad_request", "Invalid campaign"));
  return null;
};

export function mountPlanRoutes(router: Router, deps: PlanRouteDeps): void {
  const admin = (req: Request) => getSupabaseAdmin(getAppLocals(req).env);

  router.get("/campaigns/:campaignId/plan", requireSection(deps.section, "view"), asyncHandler(async (req, res) => {
    const id = campaignId(req, res);
    if (!id) return;
    const out = await readPlan(admin(req), req.auth!.orgId!, id);
    if (out.kind === "not_found") return void res.status(404).json(apiError("not_found", "Campaign not found"));
    res.json({ plan: out.plan } satisfies AdsCampaignPlanRead);
  }));

  router.post("/campaigns/:campaignId/plan/versions", requireSection(deps.section, "manage"), asyncHandler(async (req, res) => {
    const id = campaignId(req, res);
    if (!id) return;
    const parsed = adsPlanEditSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json(apiError("bad_request", parsed.error.issues[0]?.message ?? "Invalid plan"));
    const out = await savePlanEdit(admin(req), req.auth!.orgId!, await deps.actorOf(req), id, parsed.data);
    switch (out.kind) {
      case "saved": return void res.status(201).json({ plan: out.plan });
      case "not_found": return void res.status(404).json(apiError("not_found", "Campaign not found"));
      case "not_in_plan_review": return void res.status(409).json(apiError("not_in_plan_review", "The plan can be changed only while it waits for review. Reload to see the campaign."));
      case "stale": return void res.status(409).json(apiError("plan_moved", MOVED));
      case "refused": return void res.status(422).json({
        ...apiError("plan_refused", "This plan cannot be saved. Change what is marked below."),
        findings: out.findings.map((f) => ({ ...f, message: planFindingWords(f) })), off_schema: out.off_schema,
      });
    }
  }));

  router.post("/campaigns/:campaignId/plan/approval", requireSection(deps.section, "manage"), asyncHandler(async (req, res) => {
    const id = campaignId(req, res);
    if (!id) return;
    const parsed = adsPlanApprovalSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json(apiError("bad_request", "Name the plan version to approve"));
    const out = await approvePlan(admin(req), req.auth!.orgId!, await deps.actorOf(req), id, parsed.data, new Date());
    switch (out.kind) {
      case "moved": return void res.json({ state: out.to });
      case "not_found": return void res.status(404).json(apiError("not_found", "Campaign not found"));
      case "stale": return void res.status(409).json(apiError("plan_moved", MOVED));
      case "conflict": return void res.status(409).json(apiError("state_moved", "The campaign moved while you were looking. Reload and try again."));
      // The machine's refusal: the campaign is not waiting for a plan review. The other outcomes belong to Launch.
      default: return void res.status(409).json(apiError("not_in_plan_review", "The campaign is not waiting for its plan to be approved. Reload to see its state."));
    }
  }));
}
