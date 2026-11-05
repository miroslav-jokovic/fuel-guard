import type { Request, Response, Router } from "express";
import { adsCampaignCreateSchema, adsCampaignLaunchSchema, adsCampaignMoveSchema, adsCreativeDecisionSchema, isRecordId, type AdBriefSource, type AdsCampaignCreateRefusal, type AppSection } from "@silvicom/shared";
import { requireAdminOnly, requireSection } from "../../../middleware/auth.js";
import { requireFreshAuth } from "../../../middleware/requireFreshAuth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createCampaign, launchCampaign, listCampaigns, personMove, readCampaign, type MoveOutcome } from "../campaigns/campaignDoors.js";
import type { Actor } from "../settings/settingsVersions.js";
import { decideOnCreative, type DecisionOutcome } from "../campaigns/creativeDecisions.js";

/**
 * `/api/ads/campaigns` (Track S, S1b): create a campaign from a brief, list them, read one with its creatives.
 *   read     anyone who can VIEW the brief's section (the review screen's readers)
 *   create   anyone who MANAGES it — a recruiter makes a campaign (E3's done-when: "a recruiter reaches a
 *            paused simulator campaign in four clicks"). Creating spends nothing: compose runs inside the
 *            AI and render budgets, and only an approver's Launch (`ads.spend`, S1c) moves money.
 *   move     anyone who MANAGES it (S1c): regenerate, pause, archive, resume, create paused — the machine's
 *            person events. None spends: pausing and archiving are the safe direction, and a campaign
 *            created paused delivers nothing until an approver launches it.
 *   decide   anyone who MANAGES it (S1d): approve or reject one creative — `ADS_AUTHORITY.approve_creative` is
 *            a person's, and approving an ad's words and picture spends nothing; the spend is Launch's.
 *   launch   `ads.spend` (admin only, by name) with a fresh sign-in, like every door that moves money
 *            (routes/guard.ts) — Security L2, "a non-admin hitting Launch", is this gate.
 * The brief sources come from the composition root (`app.ts`), so this module never imports recruiting.
 */
export interface CampaignRouteDeps {
  section: AppSection;
  briefSourcesFor: (admin: SupabaseClient) => readonly AdBriefSource[];
  actorOf: (req: Request) => Promise<Actor>;
}

function sendMove(res: Response, out: MoveOutcome): void {
  switch (out.kind) {
    case "moved": return void res.json({ state: out.to });
    case "not_found": return void res.status(404).json(apiError("not_found", "Campaign not found"));
    case "refused": return void res.status(409).json(apiError(out.reason, out.reason === "not_this_door"
      ? "That step has its own button."
      : out.reason === "no_approved_creative" ? "Approve at least one ad first."
      : "The campaign cannot do that from where it is now. Reload to see its state."));
    case "conflict": return void res.status(409).json(apiError("state_moved", "The campaign moved while you were looking. Reload and try again."));
    case "needs_approval": return void res.status(409).json(apiError(out.refusal, out.refusal === "second_approver_missing"
      ? "This budget needs a second, different approver before it can launch."
      : "Approve the launch at these amounts (or higher) first."));
    // G-launch-gate: the door's own sentence and list, passed through (campaigns/launchCertification.ts writes both).
    case "launch_refused": return void res.status(409).json({ ...apiError(out.refusal, out.message), missing: out.missing });
  }
}

const DECISION_REFUSAL: Record<Extract<DecisionOutcome, { kind: "refused" }>["reason"], string> = {
  campaign_not_in_review: "The campaign is not waiting for review any more. Reload to see its state.",
  not_ready: "This ad was already decided, or is not finished yet. Reload to see it.",
  settings_not_saved: "Save the ads settings before reviewing ads.",
  creative_not_found: "Ad not found",
  approval_not_found: "The decision could not be recorded. Try again.",
  approval_mismatch: "The decision could not be recorded. Try again.",
  approval_withdrawn: "The decision could not be recorded. Try again.",
};

const campaignId = (req: Request, res: Response): string | null => {
  const id = String(req.params.campaignId);
  if (isRecordId(id)) return id;
  res.status(400).json(apiError("bad_request", "Invalid campaign"));
  return null;
};

const refusalText: Record<AdsCampaignCreateRefusal, [number, string]> = {
  brief_source_unknown: [400, "This kind of brief cannot be advertised."],
  brief_unavailable: [409, "This opening cannot be advertised: it is not open, or it has nothing saved yet."],
  settings_not_saved: [409, "Save the ads spending limits before creating a campaign."],
  connection_unusable: [409, "That ad account is not connected. Connect or test it in Settings › Ads control."],
  brand_kit_unusable: [409, "That brand kit is archived or has nothing saved yet."],
  id_taken: [409, "This request id was already used for something else. Reload and try again."],
};

export function mountCampaignRoutes(router: Router, deps: CampaignRouteDeps): void {
  const admin = (req: Request) => getSupabaseAdmin(getAppLocals(req).env);

  router.get("/campaigns", requireSection(deps.section, "view"), asyncHandler(async (req, res) => {
    res.json({ campaigns: await listCampaigns(admin(req), req.auth!.orgId!) });
  }));

  router.get("/campaigns/:campaignId", requireSection(deps.section, "view"), asyncHandler(async (req, res) => {
    const id = String(req.params.campaignId);
    if (!isRecordId(id)) return void res.status(400).json(apiError("bad_request", "Invalid campaign"));
    const campaign = await readCampaign(admin(req), req.auth!.orgId!, id);
    if (!campaign) return void res.status(404).json(apiError("not_found", "Campaign not found"));
    res.json({ campaign });
  }));

  router.post("/campaigns", requireSection(deps.section, "manage"), asyncHandler(async (req, res) => {
    const parsed = adsCampaignCreateSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json(apiError("bad_request", parsed.error.issues[0]?.message ?? "Invalid campaign"));
    const a = admin(req);
    const out = await createCampaign({ admin: a, briefSources: deps.briefSourcesFor(a) }, req.auth!.orgId!, req.auth!.userId, parsed.data);
    if (out.kind === "refused") {
      const [status, text] = refusalText[out.refusal];
      return void res.status(status).json(apiError(out.refusal, text));
    }
    res.status(out.kind === "created" ? 201 : 200).json({ id: out.id });
  }));

  router.post("/campaigns/:campaignId/moves", requireSection(deps.section, "manage"), asyncHandler(async (req, res) => {
    const id = campaignId(req, res);
    if (!id) return;
    const parsed = adsCampaignMoveSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json(apiError("bad_request", "Unknown step"));
    sendMove(res, await personMove(admin(req), req.auth!.orgId!, await deps.actorOf(req), id, parsed.data, new Date()));
  }));

  router.post("/campaigns/:campaignId/creatives/:creativeId/decision", requireSection(deps.section, "manage"), asyncHandler(async (req, res) => {
    const id = campaignId(req, res);
    if (!id) return;
    const creativeId = String(req.params.creativeId);
    if (!isRecordId(creativeId)) return void res.status(400).json(apiError("bad_request", "Invalid ad"));
    const parsed = adsCreativeDecisionSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json(apiError("bad_request", parsed.error.issues[0]?.message ?? "Invalid decision"));
    const out = await decideOnCreative(admin(req), req.auth!.orgId!, await deps.actorOf(req), id, creativeId, parsed.data, new Date());
    if (out.kind === "not_found") return void res.status(404).json(apiError("not_found", "Ad not found"));
    if (out.kind === "refused") return void res.status(409).json(apiError(out.reason, DECISION_REFUSAL[out.reason]));
    res.json({ state: out.state });
  }));

  router.post("/campaigns/:campaignId/launch", requireAdminOnly("ads.spend"), requireFreshAuth(), asyncHandler(async (req, res) => {
    const id = campaignId(req, res);
    if (!id) return;
    const parsed = adsCampaignLaunchSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json(apiError("bad_request", "A daily budget and a lifetime cap are required"));
    sendMove(res, await launchCampaign(admin(req), req.auth!.orgId!, await deps.actorOf(req), id, parsed.data, new Date()));
  }));
}
