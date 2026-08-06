import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import * as Sentry from "@sentry/node";
import { APP_NAME } from "@fuelguard/shared";
import type { Env } from "./env.js";
import { setAppLocals } from "./lib/appLocals.js";
import { apiError } from "./lib/http.js";
import { requireAuth } from "./middleware/auth.js";
import { registerAllHandlers } from "./services/queue/handlers/index.js";
import { invitesRouter } from "./routes/invites.js";
import { membersRouter } from "./routes/members.js";
import { transactionsRouter } from "./routes/transactions.js";
import { anomaliesRouter } from "./routes/anomalies.js";
import { reportsRouter } from "./routes/reports.js";
import { auditRouter } from "./routes/audit.js";
import { integrationsRouter } from "./routes/integrations.js";
import { fuelingRouter } from "./routes/fueling.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { tmsIngestRouter } from "./routes/tmsIngest.js";
import { aiRouter } from "./routes/ai.js";
import { jobsRouter } from "./routes/jobs.js";
import { dispatchRouter } from "./routes/dispatch.js";
import { hazmatRouter } from "./routes/hazmat/index.js";
import { publicHazmatRouter } from "./routes/publicHazmat.js";
import { complianceRouter } from "./routes/compliance.js";
import { meRouter } from "./routes/me.js";
import { meHazmatRouter } from "./routes/meHazmat.js";
import { messagesRouter } from "./routes/messages.js";
import { rosterDriversRouter } from "./routes/roster/drivers.js";
import { rosterCredentialsRouter } from "./routes/roster/credentials.js";
import { authRouter } from "./routes/auth.js";

/**
 * Build the Express app. Factory with no side effects so tests can construct it freely and inject
 * app.locals.verifyToken to bypass real JWKS verification.
 */
export function createApp(env: Env): Express {
  const app = express();
  setAppLocals(app, { env });
  registerAllHandlers(); // queue handlers available for dispatchJob (both execution modes)
  app.set("trust proxy", 1); // Railway runs behind a proxy

  // CSP tuned for the single-service deploy where this server also serves the SPA: the browser talks
  // directly to Supabase (REST + realtime websockets + storage images), so those origins must be
  // allowed in connect/img. Harmless for API-only responses (JSON carries no CSP-restricted content).
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          // maplibre-gl runs its tile decoder in a Worker created from a blob: URL.
          workerSrc: ["'self'", "blob:"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "blob:", "https://*.supabase.co"],
          connectSrc: [
            "'self'",
            "https://*.supabase.co",
            "wss://*.supabase.co",
            "https://*.sentry.io",
          ],
          fontSrc: ["'self'", "data:"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'self'"],
        },
      },
    }),
  );
  app.use(cors({ origin: env.ALLOWED_ORIGINS, credentials: true }));

  // TMS agent ingest — token-authenticated (NOT a browser/user), so it's mounted BEFORE the global 1 MB JSON
  // parser: it brings its own larger body parser (≤1000-row batches) and must not inherit the browser API's
  // rules. Its own rate limiter guards against abuse / token-guessing. It still 401s unauthenticated requests,
  // so the route-auth fitness test covers it like any other router.
  const ingestLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  });
  app.use("/api/tms", ingestLimiter);
  app.use("/api/tms", tmsIngestRouter());

  // Browser report upload (P0-1): a month of EFS rows as JSON can exceed the general 1mb cap — give
  // ONLY this route a bigger parser (mounted first; express.json skips bodies already parsed).
  app.use("/api/transactions/import-report", express.json({ limit: "25mb" }));

  // Capture the exact raw body so provider webhooks (Samsara) can be HMAC-verified byte-for-byte.
  app.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );

  // Rate limiting (audit M8): a general API cap + a stricter cap on sensitive/expensive routes.
  const apiLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 600,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  });
  const strictLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  });
  // M7: the public calculator is unauthenticated → its own tighter limiter on the abuse surface.
  const calcLimiter = rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  });
  app.use("/api", apiLimiter);
  app.use("/api/invites", strictLimiter);
  app.use("/api/auth", strictLimiter); // public login exchange — worst-case abuse target
  app.use("/api/reports", strictLimiter);
  app.use("/api/integrations", strictLimiter);
  app.use("/api/ai", strictLimiter);
  app.use("/api/public", calcLimiter); // M7 public calculator — unauthenticated, tighter limit

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
  app.use("/api/me/hazmat", meHazmatRouter()); // driver capture surface (M6) — before /api/me so this prefix wins
  app.use("/api/me", meRouter()); // driver self-view: profile, loads, score, shift/duty (sub-paths of /api/me)
  app.use("/api/messages", messagesRouter()); // driver ↔ dispatch messaging
  app.use("/api/members", membersRouter());
  app.use("/api/auth", authRouter()); // PUBLIC driver-login exchange (its own throttles + uniform errors)
  app.use("/api/roster/drivers", rosterDriversRouter()); // admin-owned driver master data + app enrollment
  app.use("/api/roster/drivers", rosterCredentialsRouter()); // company-issued app logins (DC4)
  app.use("/api/transactions", transactionsRouter());
  app.use("/api/anomalies", anomaliesRouter());
  app.use("/api/reports", reportsRouter());
  app.use("/api/audit", auditRouter());
  app.use("/api/integrations", integrationsRouter());
  app.use("/api/fueling", fuelingRouter());
  app.use("/api/ai", aiRouter());
  app.use("/api/jobs", jobsRouter());
  app.use("/api/dispatch", dispatchRouter()); // was defined but unmounted on main — wired here
  app.use("/api/public/hazmat", publicHazmatRouter()); // M7: public, unauthenticated calculator + HMT lookup
  app.use("/api/hazmat", hazmatRouter());
  app.use("/api/compliance", complianceRouter()); // temporal compliance master data — certifications feed the §5 gate (M1)
  app.use("/api/webhooks", webhooksRouter()); // provider-signed; no user auth

  // ── Serve the built web SPA (single-service deploy) ─────────────────────────────────────────
  // Only when the build output exists, so API-only/dev runs and tests are unaffected.
  const here = path.dirname(fileURLToPath(import.meta.url)); // apps/api/src
  const webDist = env.WEB_DIST ?? path.resolve(here, "../../web/dist");
  if (fs.existsSync(path.join(webDist, "index.html"))) {
    // Hashed asset files are immutable → cache hard. index.html is served separately (below) with
    // no-cache, so a new deploy's entry point is never stale relative to its asset hashes.
    app.use(
      express.static(webDist, {
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          }
        },
      }),
    );
    // SPA history fallback: only for navigation paths (no file extension). A request for a missing
    // asset (…/foo.js, …/bar.css) must 404 — never fall back to index.html, or the browser rejects
    // the HTML as the wrong MIME type. Keeps deploy hash-mismatches from silently breaking the app.
    app.get(/^\/(?!api\/|healthz).*/, (req: Request, res: Response, next: NextFunction) => {
      if (path.extname(req.path)) return next(); // asset-like but not found → real 404
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(webDist, "index.html"));
    });
  }

  // Sentry captures unhandled route errors here (no-op unless SENTRY_DSN is set), before our own
  // handler formats the client response. Must be after all routes, before the error responder.
  Sentry.setupExpressErrorHandler(app);

  // Structured error handler — never echo upstream errors verbatim (audit L8).
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[api] unhandled error:", err);
    if (!res.headersSent) {
      res.status(500).json(apiError("internal_error", "Unexpected server error"));
    }
  });

  return app;
}
