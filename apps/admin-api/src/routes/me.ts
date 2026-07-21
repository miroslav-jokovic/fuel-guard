import { Router, type Request, type Response } from "express";
import { requirePlatformAuth, requireAAL2, requirePlatformAdmin } from "../middleware/platformAuth.js";

/** GET /admin/me — the authenticated platform admin, behind the full gate (auth → aal2 → allowlist). */
export function meRouter(): Router {
  const r = Router();
  r.use(requirePlatformAuth, requireAAL2, requirePlatformAdmin);
  r.get("/", (req: Request, res: Response) => {
    const p = req.platform!;
    res.json({ id: p.id, email: p.email, role: p.role, mfaEnrolledAt: p.mfaEnrolledAt });
  });
  return r;
}
