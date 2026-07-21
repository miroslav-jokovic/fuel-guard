import { Router, type Request, type Response } from "express";
import { requirePlatformAuth, requireAAL2, requirePlatformAdmin } from "../middleware/platformAuth.js";
import { adminClient } from "../lib/supabaseAdmin.js";
import { writePlatformAudit } from "../lib/audit.js";
import { apiError } from "../lib/http.js";
import { listActiveGrants, revokeGrant } from "../lib/impersonation.js";

/** /admin/impersonation — the caller's active read-only support sessions (list + revoke). */
export function impersonationRouter(): Router {
  const r = Router();
  r.use(requirePlatformAuth, requireAAL2, requirePlatformAdmin);

  // The caller's own active grants (drives the "you are viewing <org>" banner).
  r.get("/", async (req: Request, res: Response) => {
    try {
      const grants = await listActiveGrants(adminClient(req), req.platform!.id);
      res.json({ grants });
    } catch {
      res.status(500).json(apiError("internal_error", "Could not load sessions"));
    }
  });

  // End one of the caller's own sessions early.
  r.post("/:id/revoke", async (req: Request, res: Response) => {
    const id = req.params.id;
    if (typeof id !== "string") {
      res.status(400).json(apiError("invalid_request", "Invalid grant id"));
      return;
    }
    try {
      const admin = adminClient(req);
      const actor = req.platform!;
      const ok = await revokeGrant(admin, actor.id, id);
      if (!ok) {
        res.status(404).json(apiError("not_found", "Session not found"));
        return;
      }
      const ua = req.headers["user-agent"];
      await writePlatformAudit(admin, actor, {
        action: "impersonation.revoke",
        targetEntity: "support_impersonation_grants",
        targetId: id,
        ip: req.ip ?? null,
        userAgent: typeof ua === "string" ? ua : null,
      });
      res.json({ ok: true });
    } catch {
      res.status(500).json(apiError("internal_error", "Could not end the session"));
    }
  });

  return r;
}
