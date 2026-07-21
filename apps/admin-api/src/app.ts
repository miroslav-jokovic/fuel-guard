import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { APP_NAME } from "@fuelguard/shared";
import type { Env } from "./env.js";
import { setAppLocals } from "./lib/appLocals.js";
import { apiError } from "./lib/http.js";
import { meRouter } from "./routes/me.js";
import { orgsRouter } from "./routes/orgs.js";

/**
 * Build the PLATFORM (admin) Express app. Factory with no side effects so tests can construct it freely
 * and inject app.locals.verifyToken / lookupPlatformAdmin to bypass real JWKS + DB.
 */
export function createApp(env: Env): Express {
  const app = express();
  setAppLocals(app, { env });
  app.set("trust proxy", 1); // Railway runs behind a proxy

  // Strict CSP for the platform plane: the admin SPA talks only to Supabase (auth + REST/websocket). No
  // maps, no blob workers, no framing. HSTS is forced — the admin subdomain is always HTTPS.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'", "https://*.supabase.co", "wss://*.supabase.co"],
          fontSrc: ["'self'", "data:"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
    }),
  );
  app.use(cors({ origin: env.ALLOWED_ORIGINS, credentials: true }));
  app.use(express.json({ limit: "1mb" }));

  // The platform plane is low-volume + high-value: one tight cap over the whole /admin surface.
  const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 300, standardHeaders: "draft-7", legacyHeaders: false });
  app.use("/admin", limiter);

  app.get("/healthz", (_req: Request, res: Response) => {
    res.json({ status: "ok", service: `${APP_NAME} Admin API`, env: env.NODE_ENV });
  });

  // Gated routers. Every /admin/* router mounts the full chain (auth → aal2 → allowlist); the route-auth
  // fitness test discovers these mounts and proves each rejects unauthenticated (401) + non-admin (403).
  app.use("/admin/me", meRouter());
  app.use("/admin/orgs", orgsRouter());

  // ── Serve the built admin SPA (single-service deploy for the platform plane) ────────────────
  const here = path.dirname(fileURLToPath(import.meta.url)); // apps/admin-api/src
  const adminDist = env.ADMIN_DIST ?? path.resolve(here, "../../admin/dist");
  if (fs.existsSync(path.join(adminDist, "index.html"))) {
    app.use(
      express.static(adminDist, {
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          }
        },
      }),
    );
    // SPA history fallback for navigation paths only (never for /admin API paths or missing assets).
    app.get(/^\/(?!admin\/|healthz).*/, (req: Request, res: Response, next: NextFunction) => {
      if (path.extname(req.path)) return next();
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(adminDist, "index.html"));
    });
  }

  // Structured error handler — never echo upstream errors verbatim.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[admin-api] unhandled error:", err);
    if (!res.headersSent) {
      res.status(500).json(apiError("internal_error", "Unexpected server error"));
    }
  });

  return app;
}
