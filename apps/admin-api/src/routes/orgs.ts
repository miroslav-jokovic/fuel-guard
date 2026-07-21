import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requirePlatformAuth, requireAAL2, requirePlatformAdmin, requirePlatformRole } from "../middleware/platformAuth.js";
import { adminClient } from "../lib/supabaseAdmin.js";
import { writePlatformAudit } from "../lib/audit.js";
import { apiError } from "../lib/http.js";
import { listOrgs, getOrgDetail } from "../lib/orgs.js";
import { listOrgMembers, setOrgModuleEnabled } from "../lib/members.js";
import { startGrant, getActiveGrant, viewOrgAnomalies, writeTenantAudit } from "../lib/impersonation.js";

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

  // ── Read-only impersonation ("view as customer") ──────────────────────────────────────────────
  // Start a time-boxed, reason-required grant. Support role and up (never platform_readonly). Dual-audited:
  // our platform log AND the customer's own audit_logs, so platform involvement is transparent to them.
  const startSchema = z.object({ reason: z.string().trim().min(3).max(500) });
  r.post(
    "/:id/impersonation",
    requirePlatformRole("platform_owner", "platform_admin", "platform_support"),
    async (req: Request, res: Response) => {
      const id = req.params.id;
      if (typeof id !== "string") {
        res.status(400).json(apiError("invalid_request", "Invalid organization id"));
        return;
      }
      const parsed = startSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(apiError("invalid_request", "A reason (3-500 chars) is required"));
        return;
      }
      try {
        const admin = adminClient(req);
        const actor = req.platform!;
        const grant = await startGrant(admin, actor.id, id, parsed.data.reason);
        const ua = req.headers["user-agent"];
        await writePlatformAudit(admin, actor, {
          action: "impersonation.start",
          targetOrgId: id,
          targetEntity: "support_impersonation_grants",
          targetId: grant.id,
          reason: parsed.data.reason,
          after: { scope: grant.scope, expiresAt: grant.expiresAt },
          ip: req.ip ?? null,
          userAgent: typeof ua === "string" ? ua : null,
        });
        // Transparency: the customer's OWN trail records that platform support opened a read-only session.
        await writeTenantAudit(admin, id, actor.userId, "platform.impersonation.start", {
          admin_email: actor.email,
          scope: grant.scope,
          reason: parsed.data.reason,
          expires_at: grant.expiresAt,
        });
        res.json({ grant });
      } catch {
        res.status(500).json(apiError("internal_error", "Could not start the session"));
      }
    },
  );

  // A grant-gated read-only customer view (recent anomalies). Requires the caller's ACTIVE grant for the org.
  r.get("/:id/view/anomalies", async (req: Request, res: Response) => {
    const id = req.params.id;
    if (typeof id !== "string") {
      res.status(400).json(apiError("invalid_request", "Invalid organization id"));
      return;
    }
    try {
      const admin = adminClient(req);
      const actor = req.platform!;
      const grant = await getActiveGrant(admin, actor.id, id);
      if (!grant) {
        res.status(403).json(apiError("no_active_grant", "No active read-only session for this customer"));
        return;
      }
      const anomalies = await viewOrgAnomalies(admin, id);
      const ua = req.headers["user-agent"];
      await writePlatformAudit(admin, actor, {
        action: "impersonation.view",
        targetOrgId: id,
        targetEntity: "anomalies",
        ip: req.ip ?? null,
        userAgent: typeof ua === "string" ? ua : null,
      });
      res.json({ anomalies });
    } catch {
      res.status(500).json(apiError("internal_error", "Could not load the customer view"));
    }
  });

  return r;
}
