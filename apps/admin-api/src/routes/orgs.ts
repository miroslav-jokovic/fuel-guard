import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  requirePlatformAuth,
  requireAAL2,
  requirePlatformAdmin,
  requirePlatformRole,
  requireStepUp,
} from "../middleware/platformAuth.js";
import { adminClient } from "../lib/supabaseAdmin.js";
import { writePlatformAudit } from "../lib/audit.js";
import { apiError } from "../lib/http.js";
import { listOrgs, getOrgDetail, setOrgEntitlement } from "../lib/orgs.js";
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
  // audited. Never provisions or touches secrets — that stays in the customer flow.
  //
  // Step-up required (audit 2026-08-09, finding 3.8). "Reversible" was the old justification for
  // skipping it, and it is the wrong test: reversibility says how hard the damage is to undo, not how
  // hard the action is to reach. Turning a tenant's module off is a production outage for them, and
  // AAL2 alone only proves MFA happened at SOME point in this hour-long token's life — not that the
  // person issuing the command is the person who passed it.
  const toggleSchema = z.object({ enabled: z.boolean() });
  r.post(
    "/:id/modules/:provider",
    requirePlatformRole("platform_owner", "platform_admin"),
    requireStepUp,
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

  // Grant/revoke a SELLABLE-MODULE entitlement (org_modules, 0088) — the commercial control plane
  // (plan Phase 5.3, D-PM6). Distinct from the integrations toggle above (org_integrations): this
  // is what makes HazmatGuard/Training/etc exist for a tenant at all. Owner/admin only, audited to
  // the platform trail AND the customer's own trail (a bought/removed product is visible to them).
  // Upsert semantics: the first grant creates the row (unlike the integration toggle, which only
  // flips existing connections).
  //
  // Step-up required (audit 2026-08-09, finding 3.8) — this is a commercial grant against a customer
  // account, and the same argument as the module toggle above applies: reversible is not the same as
  // low-stakes, and AAL2 is a property of the session, not of this request.
  r.post(
    "/:id/entitlements/:moduleKey",
    requirePlatformRole("platform_owner", "platform_admin"),
    requireStepUp,
    async (req: Request, res: Response) => {
      const id = req.params.id;
      const moduleKey = req.params.moduleKey;
      if (typeof id !== "string" || typeof moduleKey !== "string") {
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
        const actor = req.platform!;
        const result = await setOrgEntitlement(admin, id, moduleKey, parsed.data.enabled, actor.userId ?? null);
        if (!result.ok) {
          res.status(400).json(apiError("invalid_request", result.error));
          return;
        }
        const ua = req.headers["user-agent"];
        await writePlatformAudit(admin, actor, {
          action: parsed.data.enabled ? "entitlement.grant" : "entitlement.revoke",
          targetOrgId: id,
          targetEntity: "org_modules",
          reason: result.moduleKey,
          after: { moduleKey: result.moduleKey, enabled: parsed.data.enabled },
          ip: req.ip ?? null,
          userAgent: typeof ua === "string" ? ua : null,
        });
        res.json({ ok: true, moduleKey: result.moduleKey, enabled: parsed.data.enabled });
      } catch {
        res.status(500).json(apiError("internal_error", "Could not update the entitlement"));
      }
    },
  );

  // ── Read-only impersonation ("view as customer") ──────────────────────────────────────────────
  // Start a time-boxed, reason-required grant. Support role and up (never platform_readonly). Dual-audited:
  // our platform log AND the customer's own audit_logs, so platform involvement is transparent to them.
  //
  // Step-up required (audit 2026-08-09, finding 3.8). This is the crown jewel of the platform plane —
  // it mints cross-tenant read access to a customer's data — and it was reachable for the full life of
  // a stolen access token. Of everything behind this router, this is the one that most needs the
  // operator to prove a second factor at the moment they act.
  const startSchema = z.object({ reason: z.string().trim().min(3).max(500) });
  r.post(
    "/:id/impersonation",
    requirePlatformRole("platform_owner", "platform_admin", "platform_support"),
    requireStepUp,
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
