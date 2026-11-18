import type { Request, Response, Router } from "express";
import { adsSwipePageSaveSchema, adsSwipePictureSaveSchema, type AppSection } from "@silvicom/shared";
import { requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { dispatchJob } from "../../../queue/dispatch.js";
import { checkOutboundUrl } from "../../../lib/ssrfGuard.js";
import type { Actor } from "../settings/settingsVersions.js";
import { assetUploadUrl } from "../creative/brandAssets.js";
import { archiveSwipe, listSwipe, readAgain, saveSwipePage, saveSwipePicture } from "../research/swipeFile.js";

/**
 * `/api/ads/swipe` — the swipe file (ADS-PLATFORM-V2-PLAN V2r, D-AD36): competitors' job pages and ad pictures a
 * recruiter saves, which the Researcher and the Swipe reader read into evidence for a campaign's plan.
 *   read     anyone who can VIEW the brief's section
 *   write    anyone who MANAGES it (`ADS_AUTHORITY.save_to_swipe_file: person`) — a recruiter saves what they
 *            see on Facebook or a competitor's site; nothing here spends, publishes or touches a vendor account.
 *            Removal is an archive (`delete_anything` is "never").
 * Mounted on `adsRouter` (routes/guard.ts), so `requireAuth` + `requireOrg` are already in force.
 *
 * Saving queues the read (`ads_swipe_read`); "Read again" is a new attempt. The address is held to https with no
 * embedded credentials here, so a typo is told at once; whether its host is public is decided at the fetch, on
 * every hop, because a name can resolve differently tomorrow (`research/pageFetch.ts`).
 */
const PICTURE_REFUSALS: Record<string, string> = {
  unsupported_format: "The swipe file takes a PNG, JPEG or WebP picture.",
  unsafe_svg: "The swipe file takes a PNG, JPEG or WebP picture.",
  unreadable: "The picture could not be read. Save it again as PNG or JPEG.",
  too_large: "The picture is too large.",
};

export function mountSwipeRoutes(router: Router, deps: { section: AppSection; actorOf: (req: Request) => Promise<Actor> }): void {
  const admin = (req: Request) => getSupabaseAdmin(getAppLocals(req).env);
  const write = requireSection(deps.section, "manage");
  const queueRead = (req: Request, entryId: string, attempt: number) =>
    dispatchJob(admin(req), getAppLocals(req).env, "ads_swipe_read", { orgId: req.auth!.orgId!, payload: { entryId }, dedupKey: `ads_swipe_read:${entryId}:${attempt}`, requestedBy: req.auth!.userId ?? null });

  router.get("/swipe", requireSection(deps.section, "view"), asyncHandler(async (req, res) => {
    res.json({ entries: await listSwipe(admin(req), req.auth!.orgId!) });
  }));

  router.post("/swipe/pages", write, asyncHandler(async (req, res) => {
    const parsed = adsSwipePageSaveSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json(apiError("bad_request", "Give the page's full https address, and a note of at most 300 characters."));
    // Scheme and credentials only (`allowPrivateAddresses` skips the DNS checks, which the fetch makes on every hop).
    const shape = await checkOutboundUrl(parsed.data.url, { allowPrivateAddresses: true });
    if (!shape.ok) return void res.status(400).json(apiError("ads_swipe_address", "Give the page's full https address, with no user name or password in it."));
    const saved = await saveSwipePage(admin(req), req.auth!.orgId!, await deps.actorOf(req), { ...parsed.data, url: shape.url });
    await queueRead(req, saved.id, 1);
    res.status(201).json(saved);
  }));

  router.post("/swipe/pictures/upload-url", write, asyncHandler(async (req, res) => {
    res.json(await assetUploadUrl(admin(req), req.auth!.orgId!));
  }));

  router.post("/swipe/pictures", write, asyncHandler(async (req, res) => {
    const parsed = adsSwipePictureSaveSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json(apiError("bad_request", "Invalid upload"));
    const out = await saveSwipePicture(admin(req), req.auth!.orgId!, await deps.actorOf(req), parsed.data);
    if (out.kind === "not_found") return void res.status(404).json(apiError("not_found", "Nothing was uploaded under this id."));
    if (out.kind === "refused") return void res.status(422).json(apiError(`ads_swipe_${out.code}`, PICTURE_REFUSALS[out.code] ?? "The picture could not be saved."));
    await queueRead(req, out.id, 1);
    res.status(201).json({ id: out.id });
  }));

  router.post("/swipe/:entryId/read", write, asyncHandler(async (req, res) => {
    const out = await readAgain(admin(req), req.auth!.orgId!, String(req.params.entryId));
    if (out.kind === "not_found") return void notFound(res);
    if (out.kind === "waiting") return void res.status(409).json(apiError("ads_swipe_reading", "This entry is being read now."));
    await queueRead(req, String(req.params.entryId), out.attempt);
    res.status(202).json({ attempt: out.attempt });
  }));

  router.post("/swipe/:entryId/archive", write, asyncHandler(async (req, res) => {
    if (!(await archiveSwipe(admin(req), req.auth!.orgId!, String(req.params.entryId), new Date()))) return void notFound(res);
    res.status(200).json({ archived: true });
  }));
}

function notFound(res: Response): void {
  res.status(404).json(apiError("not_found", "This swipe entry does not exist."));
}
