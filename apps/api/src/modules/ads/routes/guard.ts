import { Router, type Request, type Response } from "express";
import { adsKillSwitchSchema, adsSettingsSaveSchema, adsSpendApprovalSchema, isRecordId, type AdsSettingsView } from "@silvicom/shared";
import { requireAdminOnly, requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { requireFreshAuth } from "../../../middleware/requireFreshAuth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { displayNameFor } from "../../../lib/memberLabels.js";
import { recordApproval } from "../guard/approvals.js";
import { setKillSwitch } from "../guard/killSwitch.js";
import { mountConnectionRoutes } from "./connections.js";
import { saveSettingsVersion, settingsInForce, type Actor } from "../settings/settingsVersions.js";

/**
 * `/api/ads` — the guard's doors (ADS-AGENT-BUILD-WORKFLOW.md A5; plan §4b, §5).
 *
 * Who, from `ADS_AUTHORITY` and the named-grant list, not a role list written here:
 *   · read Settings › Ads control — anyone who can VIEW the brief's section (recruitment, the one
 *     brief source today; plan §4b "readable by recruiters");
 *   · press the kill switch — anyone who MANAGES that section (`kill_switch_on: person`, the safe
 *     direction, and no password prompt: a brake that asks for a password first is one nobody pulls
 *     in a hurry — the Med-Stop door's reasoning);
 *   · save settings, clear the kill switch, approve or withdraw a launch / raise / area change —
 *     `ads.spend` (admin only, by name) with a fresh sign-in, because each moves real money.
 * When a second brief source exists (D-AD17), the section becomes the brief's own; until then this is
 * recruitment's ads page and the gate says so.
 */

const BRIEF_SECTION = "recruitment" as const;

async function actorOf(req: Request): Promise<Actor> {
  const auth = req.auth!;
  const name = await displayNameFor(getSupabaseAdmin(getAppLocals(req).env), auth.userId, auth.orgId!, auth.role);
  return { id: auth.userId, name: (name ?? auth.email ?? "An office user").trim().slice(0, 200) || "An office user" };
}

function conflict(res: Response): void {
  res.status(409).json(apiError("ads_settings_conflict", "Someone saved the ads settings at the same moment. Reload and try again."));
}

export function adsRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireOrg);
  const spend = [requireAdminOnly("ads.spend"), requireFreshAuth()] as const;

  router.get(
    "/settings",
    requireSection(BRIEF_SECTION, "view"),
    asyncHandler(async (req, res) => {
      const s = await settingsInForce(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!);
      const body: AdsSettingsView = {
        settings: s.settings, version: s.version, kill_switch: s.kill_switch, kill_reason: s.kill_reason,
        saved_at: s.created_at, saved_by_name: s.created_by_name,
      };
      res.json(body);
    }),
  );

  router.put(
    "/settings",
    ...spend,
    asyncHandler(async (req, res) => {
      const parsed = adsSettingsSaveSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", parsed.error.issues[0]?.message ?? "Invalid settings"));
        return;
      }
      const saved = await saveSettingsVersion(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, await actorOf(req), { settings: parsed.data.settings });
      if (saved === "conflict") return conflict(res);
      res.json({ version: saved.version });
    }),
  );

  const killDoor = (on: boolean) =>
    asyncHandler(async (req, res) => {
      const parsed = adsKillSwitchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "A reason is required"));
        return;
      }
      const result = await setKillSwitch(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, await actorOf(req), on, parsed.data.reason, new Date());
      if (result.kind === "conflict") return conflict(res);
      res.json(result);
    });
  router.post("/kill-switch", requireSection(BRIEF_SECTION, "manage"), killDoor(true));
  router.post("/kill-switch/clear", ...spend, killDoor(false));

  router.post(
    "/campaigns/:campaignId/approvals",
    ...spend,
    asyncHandler(async (req, res) => {
      const campaignId = String(req.params.campaignId);
      const parsed = adsSpendApprovalSchema.safeParse(req.body);
      if (!isRecordId(campaignId) || !parsed.success) {
        res.status(400).json(apiError("bad_request", parsed.success ? "Invalid campaign" : (parsed.error.issues[0]?.message ?? "Invalid approval")));
        return;
      }
      const result = await recordApproval(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, await actorOf(req), campaignId, parsed.data);
      if (!result.ok) {
        const status = result.refusal === "campaign_not_found" ? 404 : 409;
        res.status(status).json(apiError(result.refusal, refusalText[result.refusal]));
        return;
      }
      res.status(201).json({ id: result.id });
    }),
  );

  mountConnectionRoutes(router, { section: BRIEF_SECTION, actorOf });
  return router;
}

const refusalText = {
  campaign_not_found: "Campaign not found",
  settings_not_saved: "Save the ads spending limits before approving any spend.",
  nothing_to_withdraw: "There is no approval on this campaign with that id to withdraw.",
} as const;
