import type { Request, Response, Router } from "express";
import { adAssetAcceptSchema, adBrandKitSaveSchema, adPresetSaveSchema, type AppSection } from "@silvicom/shared";
import { requireAdminOnly, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import type { Actor } from "../settings/settingsVersions.js";
import { acceptAsset, assetUploadUrl } from "../creative/brandAssets.js";
import { listBrandKits, listPresets, saveBrandKitVersion, savePresetVersion, type SaveOutcome } from "../creative/kitVersions.js";

/**
 * `/api/ads/brand-kits`, `/api/ads/presets` (workflow C1; plan D-AD10, D-AD11, §5).
 *   read     anyone who can VIEW the brief's section — the readers of Settings › Ads control
 *   write    `ads.brand-kit` (admin only, by name): `ADS_AUTHORITY.edit_settings_brand_kit_presets`
 *            is `["admin"]`. No fresh sign-in: nothing here spends or hands an account over, and a
 *            version can always be superseded by the next one.
 * Mounted on `adsRouter` (routes/guard.ts), so `requireAuth` + `requireOrg` are already in force.
 *
 * An upload is two calls: an upload URL (the browser PUTs the file there), then "accept", where the
 * API reads the bytes back, decides what they are and stores them by hash (`creative/brandAssets.ts`).
 * The accepted ref is what a kit save names; the save re-reads each one before it writes.
 */
export function mountBrandKitRoutes(router: Router, deps: { section: AppSection; actorOf: (req: Request) => Promise<Actor> }): void {
  const write = requireAdminOnly("ads.brand-kit");
  const admin = (req: Request) => getSupabaseAdmin(getAppLocals(req).env);

  router.get("/brand-kits", requireSection(deps.section, "view"), asyncHandler(async (req, res) => {
    res.json({ brand_kits: await listBrandKits(admin(req), req.auth!.orgId!) });
  }));

  router.get("/presets", requireSection(deps.section, "view"), asyncHandler(async (req, res) => {
    res.json({ presets: await listPresets(admin(req), req.auth!.orgId!) });
  }));

  router.post("/brand-kits/assets/upload-url", write, asyncHandler(async (req, res) => {
    res.json(await assetUploadUrl(admin(req), req.auth!.orgId!));
  }));

  router.post("/brand-kits/assets", write, asyncHandler(async (req, res) => {
    const parsed = adAssetAcceptSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json(apiError("bad_request", "Invalid upload"));
    const out = await acceptAsset(admin(req), req.auth!.orgId!, parsed.data.upload_id);
    if (out.kind === "not_found") return void res.status(404).json(apiError("not_found", "Nothing was uploaded under this id."));
    if (out.kind === "refused") return void res.status(422).json(apiError(out.code, out.reason));
    res.json({ asset: out.asset });
  }));

  router.post("/brand-kits", write, asyncHandler(async (req, res) => {
    const parsed = adBrandKitSaveSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json(apiError("bad_request", parsed.error.issues[0]?.message ?? "Invalid brand kit"));
    send(res, await saveBrandKitVersion(admin(req), req.auth!.orgId!, await deps.actorOf(req), parsed.data), "brand kit");
  }));

  router.post("/presets", write, asyncHandler(async (req, res) => {
    const parsed = adPresetSaveSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json(apiError("bad_request", parsed.error.issues[0]?.message ?? "Invalid preset"));
    send(res, await savePresetVersion(admin(req), req.auth!.orgId!, await deps.actorOf(req), parsed.data), "preset");
  }));
}

function send(res: Response, out: SaveOutcome, what: string): void {
  switch (out.kind) {
    case "saved": return void res.status(201).json({ id: out.id, parent_id: out.parent_id, version: out.version });
    case "conflict": return void res.status(409).json(apiError("ads_version_conflict", `Someone saved this ${what} at the same moment. Reload and try again.`));
    case "not_found": return void res.status(404).json(apiError("not_found", `This ${what} does not exist.`));
    case "archived": return void res.status(409).json(apiError("ads_archived", `This ${what} is archived; it takes no new versions.`));
    case "assets_mismatch": return void res.status(422).json({ ...apiError("ads_assets_mismatch", "A file this brand kit names was not uploaded here, or is not the file described. Upload it again."), sha256: out.sha256 });
  }
}
