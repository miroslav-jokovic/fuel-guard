import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requirePlatformAuth, requireAAL2, requirePlatformAdmin, requirePlatformRole } from "../middleware/platformAuth.js";
import { adminClient } from "../lib/supabaseAdmin.js";
import { writePlatformAudit } from "../lib/audit.js";
import { apiError } from "../lib/http.js";
import { listOrgs, getOrgDetail } from "../lib/orgs.js";
import { listOrgMembers, setOrgModuleEnabled } from "../lib/members.js";

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

  // Members of one org (emails resolved via the auth admin API). Read.
  r.get("/:id/members", async (req: Request, res: Response) => {
    const id = req.params.id;
    if (typeof id !== "string") {
      res.status(400).json(apiError("invalid_request", "Invalid organization id"));
      return;
    }
    try {
      const members = await listOrgMembers(adminClient(req), id);
      res.json({ members });
    } catch {
      res.status(500).json(apiError("internal_error", "Could not load members"));
    }
  });

  // Enable/disable an EXISTING optional module for an org (platform kill switch). Owner/admin only,
  // audited, reversible (no step-up). Never provisions or touches secrets — that stays in the customer flow.
  const toggleSchema = z.object({ enabled: z.boolean() });
  r.post(
    "/:id/modules/:provider",
    requirePlatformRole("platform_owner", "platform_admin"),
    async (req: Request, res: Response) => {
      const id = req.params.id;
      const provider = req.params.provider;
      if (typeof id !== "string" || typeof provider !== "string") {
        res.status(400).json(apiError("invalid_request", "Invalid parameters"));
        return;
      }
      const parsed = toggleSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(apiError("invalid_request", "Body must be { enabled: boolean }"));
        return;
      }
      try {
        const admin = adminClient(req);
        const ok = await setOrgModuleEnabled(admin, id, provider, parsed.data.enabled);
        if (!ok) {
          res.status(404).json(apiError("not_found", "That module is not configured for this org"));
          return;
        }
        const ua = req.headers["user-agent"];
        await writePlatformAudit(admin, req.platform!, {
          action: parsed.data.enabled ? "module.enable" : "module.disable",
          targetOrgId: id,
          targetEntity: "org_integrations",
          reason: provider,
          after: { provider, enabled: parsed.data.enabled },
          ip: req.ip ?? null,
          userAgent: typeof ua === "string" ? ua : null,
        });
        res.json({ ok: true, provider, enabled: parsed.data.enabled });
      } catch {
        res.status(500).json(apiError("internal_error", "Could not update the module"));
      }
    },
  );

  return r;
}
