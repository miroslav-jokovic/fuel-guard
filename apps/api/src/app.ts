import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { APP_NAME } from "@fleetguard/shared";
import type { Env } from "./env.js";
import { setAppLocals } from "./lib/appLocals.js";
import { apiError } from "./lib/http.js";
import { requireAuth } from "./middleware/auth.js";
import { invitesRouter } from "./routes/invites.js";
import { transactionsRouter } from "./routes/transactions.js";
import { anomaliesRouter } from "./routes/anomalies.js";
import { reportsRouter } from "./routes/reports.js";

/**
 * Build the Express app. Factory with no side effects so tests can construct it freely and inject
 * app.locals.verifyToken to bypass real JWKS verification.
 */
export function createApp(env: Env): Express {
  const app = express();
  setAppLocals(app, { env });
  app.set("trust proxy", 1); // Railway runs behind a proxy

  app.use(helmet());
  app.use(cors({ origin: env.ALLOWED_ORIGINS, credentials: true }));
  app.use(express.json({ limit: "1mb" }));

  // Rate limiting (audit M8): a general API cap + a stricter cap on sensitive/expensive routes.
  const apiLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 600, standardHeaders: "draft-7", legacyHeaders: false });
  const strictLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false });
  app.use("/api", apiLimiter);
  app.use("/api/invites", strictLimiter);
  app.use("/api/reports", strictLimiter);

  app.get("/healthz", (_req: Request, res: Response) => {
    res.json({ status: "ok", service: `${APP_NAME} API`, env: env.NODE_ENV });
  });

  // Current principal from the verified JWT (org/role may be null until membership exists).
  app.get("/api/me", requireAuth, (req: Request, res: Response) => {
    res.json({
      userId: req.auth!.userId,
      email: req.auth!.email,
      orgId: req.auth!.orgId,
      role: req.auth!.role,
    });
  });

  app.use("/api/invites", invitesRouter());
  app.use("/api/transactions", transactionsRouter());
  app.use("/api/anomalies", anomaliesRouter());
  app.use("/api/reports", reportsRouter());

  // Structured error handler — never echo upstream errors verbatim (audit L8).
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[api] unhandled error:", err);
    if (!res.headersSent) {
      res.status(500).json(apiError("internal_error", "Unexpected server error"));
    }
  });

  return app;
}
