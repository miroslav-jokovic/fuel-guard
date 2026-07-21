import { Router, type Request, type Response } from "express";
import { requirePlatformAuth, requireAAL2, requirePlatformAdmin } from "../middleware/platformAuth.js";
import { adminClient } from "../lib/supabaseAdmin.js";
import { writePlatformAudit } from "../lib/audit.js";
import { apiError } from "../lib/http.js";
import { listOrgs, getOrgDetail } from "../lib/orgs.js";

/** /admin/orgs — read-only customer oversight (Phase 1). All routes behind the full platform gate. */
export function orgsRouter(): Router {
  const r = Router();
  r.use(requirePlatformAuth, requireAAL2, requirePlatformAdmin);

  // List all customers with aggregate stats. Metadata only — not per-org-audited (would be pure noise).
  r.get("/", async (req: Request, res: Response) => {
    try {
      const orgs = await listOrgs(adminClient(req));
      res.json({ orgs });
    } catch {
      res.status(500).json(apiError("internal_error", "Could not load organizations"));
    }
  });

  // View ONE customer — a meaningful cross-tenant access, so it is written to the platform audit trail.
  r.get("/:id", async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      if (typeof id !== "string") {
        res.status(400).json(apiError("invalid_request", "Invalid organization id"));
        return;
      }
      const admin = adminClient(req);
      const detail = await getOrgDetail(admin, id);
      if (!detail) {
        res.status(404).json(apiError("not_found", "Organization not found"));
        return;
      }
      const ua = req.headers["user-agent"];
      await writePlatformAudit(admin, req.platform!, {
        action: "org.view",
        targetOrgId: detail.orgId,
        targetEntity: "organizations",
        targetId: detail.orgId,
        ip: req.ip ?? null,
        userAgent: typeof ua === "string" ? ua : null,
      });
      res.json({ org: detail });
    } catch {
      res.status(500).json(apiError("internal_error", "Could not load organization"));
    }
  });

  return r;
}
