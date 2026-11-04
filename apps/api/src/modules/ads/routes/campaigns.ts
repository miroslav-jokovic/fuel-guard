import type { Request, Router } from "express";
import { adsCampaignCreateSchema, isRecordId, type AdBriefSource, type AdsCampaignCreateRefusal, type AppSection } from "@silvicom/shared";
import { requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createCampaign, listCampaigns, readCampaign } from "../campaigns/campaignDoors.js";

/**
 * `/api/ads/campaigns` (Track S, S1b): create a campaign from a brief, list them, read one with its creatives.
 *   read     anyone who can VIEW the brief's section (the review screen's readers)
 *   create   anyone who MANAGES it — a recruiter makes a campaign (E3's done-when: "a recruiter reaches a
 *            paused simulator campaign in four clicks"). Creating spends nothing: compose runs inside the
 *            AI and render budgets, and only an approver's Launch (`ads.spend`, S1c) moves money.
 * The brief sources come from the composition root (`app.ts`), so this module never imports recruiting.
 */
export interface CampaignRouteDeps {
  section: AppSection;
  briefSourcesFor: (admin: SupabaseClient) => readonly AdBriefSource[];
}

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
}
