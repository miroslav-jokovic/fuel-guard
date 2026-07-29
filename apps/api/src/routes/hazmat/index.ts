import { Router } from "express";
import { requireAuth, requireOrg } from "../../middleware/auth.js";
import { requireModule } from "../../middleware/requireModule.js";

/**
 * HazmatGuard API (Phase H0 skeleton). Mounted at `/api/hazmat/*` behind auth + the `hazmatguard`
 * module entitlement (Phase 5E) — a tenant without the module gets one clean 403, never an empty
 * surface. The real endpoints (submit, review, placards) land in H4+; for now a health probe proves
 * the mount and the gate are live.
 */
export function hazmatRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireOrg, requireModule("hazmatguard"));

  router.get("/health", (_req, res) => {
    res.json({ ok: true, module: "hazmatguard" });
  });

  return router;
}
