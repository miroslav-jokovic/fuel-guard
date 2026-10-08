import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import {
  requirePlatformAuth,
  requireAAL2,
  requirePlatformAdmin,
  requirePlatformRole,
  requireStepUp,
} from "../middleware/platformAuth.js";
import { adminClient } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { writePlatformAudit } from "../lib/audit.js";
import { apiError } from "../lib/http.js";
import {
  approveRelease,
  fetchCandidate,
  listApprovals,
  revokeRelease,
  type ReleaseCandidate,
} from "../lib/releaseApproval.js";

/**
 * /admin/release — tonight's release, approved from the console's Settings (D-REL14, 0440).
 *
 * Any platform role may READ the candidate and who approved it. Approving and withdrawing are the
 * platform OWNER's alone, with a second factor proved in the last five minutes: an approval moves
 * production at 01:07, which until D-REL14 only a GitHub repository admin could do, and the owner is
 * the console's equivalent. Both acts reach the platform audit trail.
 *
 * Only the console that follows the `production` branch may write: the uat console writes the
 * staging database, which release.yml never reads, so a yes there would look like a go signal and
 * ship nothing.
 */
const CACHE_MS = 60_000;

const approveSchema = z.object({ prNumber: z.number().int().positive(), commitSha: z.string().regex(/^[0-9a-f]{40}$/) });
const revokeSchema = z.object({ prNumber: z.number().int().positive() });

export function releaseApprovalRouter(): Router {
  const r = Router();
  r.use(requirePlatformAuth, requireAAL2, requirePlatformAdmin);

  // One GitHub read a minute per process for the page; an approval always reads afresh.
  let cached: { at: number; candidate: ReleaseCandidate | null } | null = null;
  async function candidate(req: Request, fresh: boolean): Promise<ReleaseCandidate | null> {
    if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.candidate;
    const { env, fetchGitHub } = getAppLocals(req);
    const c = await fetchCandidate(fetchGitHub ?? fetch, env.GITHUB_REPOSITORY, env.GITHUB_TOKEN);
    cached = { at: Date.now(), candidate: c };
    return c;
  }
  const isProduction = (req: Request) => getAppLocals(req).env.RAILWAY_GIT_BRANCH === "production";

  function productionOnly(req: Request, res: Response, next: NextFunction): void {
    if (!isProduction(req)) {
      res.status(409).json(apiError("not_production", "Approve tonight's release in the production console"));
      return;
    }
    next();
  }

  r.get("/", async (req: Request, res: Response) => {
    let c: ReleaseCandidate | null;
    try {
      c = await candidate(req, false);
    } catch {
      res.status(502).json(apiError("github_unavailable", "Could not read tonight's release from GitHub"));
      return;
    }
    try {
      const approvals = c ? await listApprovals(adminClient(req), c.number) : [];
      res.json({ candidate: c, approvals, canApprove: isProduction(req) });
    } catch {
      res.status(500).json(apiError("internal_error", "Could not load release approvals"));
    }
  });

  r.post(
    "/approve",
    requirePlatformRole("platform_owner"),
    requireStepUp,
    productionOnly,
    async (req: Request, res: Response) => {
      const parsed = approveSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(apiError("invalid_request", "Body must be { prNumber, commitSha (40 hex) }"));
        return;
      }
      const { prNumber, commitSha } = parsed.data;
      let c: ReleaseCandidate | null;
      try {
        c = await candidate(req, true);
      } catch {
        res.status(502).json(apiError("github_unavailable", "Could not read tonight's release from GitHub"));
        return;
      }
      // The page the owner read must still be tonight's release: the 18:00 refresh, or a release that
      // shipped meanwhile, changes what an approval would mean.
      if (!c || c.number !== prNumber || c.shipsSha !== commitSha) {
        res.status(409).json(apiError("stale", "Tonight's release changed since this page loaded — review it again"));
        return;
      }
      try {
        const admin = adminClient(req);
        const row = await approveRelease(admin, req.platform!.id, prNumber, commitSha);
        const ua = req.headers["user-agent"];
        await writePlatformAudit(admin, req.platform!, {
          action: "release.approve",
          targetEntity: "platform_release_approvals",
          targetId: row.id,
          after: { prNumber, commitSha, pinnedByNotes: c.pinnedByNotes },
          ip: req.ip ?? null,
          userAgent: typeof ua === "string" ? ua : null,
        });
        res.status(201).json({ approvals: await listApprovals(admin, prNumber) });
      } catch {
        res.status(500).json(apiError("internal_error", "Could not record the approval"));
      }
    },
  );

  r.post(
    "/revoke",
    requirePlatformRole("platform_owner"),
    requireStepUp,
    productionOnly,
    async (req: Request, res: Response) => {
      const parsed = revokeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(apiError("invalid_request", "Body must be { prNumber }"));
        return;
      }
      const { prNumber } = parsed.data;
      try {
        const admin = adminClient(req);
        const withdrawn = await revokeRelease(admin, req.platform!.id, prNumber);
        if (withdrawn.length === 0) {
          res.status(404).json(apiError("not_found", "Nothing approved in the console for that release"));
          return;
        }
        const ua = req.headers["user-agent"];
        await writePlatformAudit(admin, req.platform!, {
          action: "release.revoke",
          targetEntity: "platform_release_approvals",
          targetId: null,
          before: { prNumber, commitShas: withdrawn },
          ip: req.ip ?? null,
          userAgent: typeof ua === "string" ? ua : null,
        });
        res.json({ approvals: [] });
      } catch {
        res.status(500).json(apiError("internal_error", "Could not withdraw the approval"));
      }
    },
  );

  return r;
}
