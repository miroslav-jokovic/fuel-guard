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
import { apiError, asyncHandler, HttpError } from "./lib/http.js";
import { getBuildInfo } from "./lib/buildInfo.js";
import { getSchemaStatus } from "./lib/schemaVersion.js";
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
import { fuelCardControlRouter } from "./routes/fuelCards/control.js";
import { fuelCardExperimentsRouter } from "./routes/fuelCards/experiments.js";
import { fuelCardProbeRouter } from "./routes/fuelCards/probe.js";
import { fuelCardSettingsRouter } from "./routes/fuelCards/settings.js";
import { fuelCardWriteProbeRouter } from "./routes/fuelCards/writeProbe.js";
import { fuelCardsRouter } from "./routes/fuelCards/read.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { tmsIngestRouter } from "./routes/tmsIngest.js";
import { aiRouter } from "./routes/ai.js";
import { jobsRouter } from "./routes/jobs.js";
import { dispatchRouter } from "./routes/dispatch.js";
import { hazmatRouter } from "./routes/hazmat/index.js";
import { publicHazmatRouter } from "./routes/publicHazmat.js";
import { complianceRouter } from "./routes/compliance.js";
import { driverAppSettingsRouter } from "./routes/driverAppSettings.js";
import { meRouter } from "./routes/me.js";
import { meHazmatRouter } from "./routes/meHazmat.js";
import { notificationsRouter } from "./routes/notifications.js";
import { messagesRouter } from "./routes/messages.js";
import { rosterDriversRouter } from "./routes/roster/drivers.js";
import { rosterCredentialsRouter } from "./routes/roster/credentials.js";
import { authRouter } from "./routes/auth.js";
import { authStepUpRouter } from "./routes/authStepUp.js";
import { versionRouter } from "./routes/version.js";

/**
 * CSP tuned for the single-service deploy where this server also serves the SPA: the browser talks
 * directly to Supabase (REST + realtime websockets + storage images), so those origins must be
 * allowed in connect/img. Harmless for API-only responses (JSON carries no CSP-restricted content).
 */
function securityMiddleware(env: Env) {
  const apiConnectSrc = env.VITE_API_URL ? [env.VITE_API_URL] : [];
  return helmet({
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
          ...apiConnectSrc,
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
  });
}

/**
 * Build the Express app. Factory with no side effects so tests can construct it freely and inject
 * app.locals.verifyToken to bypass real JWKS verification.
 */
export function createApp(env: Env): Express {
  const app = express();
  setAppLocals(app, { env });
  registerAllHandlers(); // queue handlers available for dispatchJob (both execution modes)
  app.set("trust proxy", 1); // Railway runs behind a proxy

  app.use(securityMiddleware(env));
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

  // Rate limiting (audit M8): a general API cap + stricter caps on sensitive/expensive routes.
  //
  // The general cap is mounted HERE, ahead of every body parser, on purpose. It used to sit below
  // them, which meant an unauthenticated POST to /api/transactions/import-report was buffered and
  // JSON.parsed at up to 25mb BEFORE the limiter ever ran — the 429 was returned after the cost had
  // already been paid, on the single service that also serves the SPA (audit 2026-08-09, finding
  // 3.8). Middleware runs in registration order, so ordering is the whole fix.
  const apiLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 600,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  });
  app.use("/api", apiLimiter);

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
  app.use("/api/invites", strictLimiter);
  app.use("/api/auth", strictLimiter); // public login exchange — worst-case abuse target
  app.use("/api/reports", strictLimiter);
  app.use("/api/integrations", strictLimiter);
  app.use("/api/fuel-cards", strictLimiter); // dials a rate-paced vendor on a shared service account
  app.use("/api/ai", strictLimiter);
  app.use("/api/public", calcLimiter); // M7 public calculator — unauthenticated, tighter limit

  // Liveness for Railway AND a one-glance answer to "is this deploy whole?". Always 200 — a schema
  // that is merely behind is a degraded deploy, not a dead process, and failing the healthcheck
  // would make Railway roll back the very build that is waiting on the migration. Detail lives in
  // GET /api/version; the schema read behind this is cached for 30s (lib/schemaVersion.ts).
  app.get(
    "/healthz",
    asyncHandler(async (_req: Request, res: Response) => {
      const schema = await getSchemaStatus(env);
      res.json({
        status: schema.drift ? "degraded" : "ok",
        service: `${APP_NAME} API`,
        env: env.NODE_ENV,
        commit: getBuildInfo().commitShort,
        schema: schema.state,
      });
    }),
  );

  // Current principal from the verified JWT (org/role may be null until membership exists).
  app.get("/api/me", requireAuth, (req: Request, res: Response) => {
    res.json({
      userId: req.auth!.userId,
      email: req.auth!.email,
      orgId: req.auth!.orgId,
      role: req.auth!.role,
    });
  });

  // Deploy truth (ship-pipeline D0.3). Public by design — see routes/version.ts.
  app.use("/api/version", versionRouter());
  app.use("/api/invites", invitesRouter());
  // Phase 6: the notification centre. Written for this prefix all along ("Mounted under
  // /api/me/notifications" in its header) but never wired — the whole API was dead code until
  // this line. Mounted in the plain `path, xRouter()` shape every other router uses: the auth
  // fitness test discovers mounts from this file's source, and a mount with middleware spliced in
  // between was invisible to it (the router now applies requireAuth itself). Before /api/me so the
  // longer prefix wins.
  app.use("/api/me/notifications", notificationsRouter());
  app.use("/api/me/hazmat", meHazmatRouter()); // driver capture surface (M6) — before /api/me so this prefix wins
  app.use("/api/me", meRouter()); // driver self-view: profile, loads, score, shift/duty (sub-paths of /api/me)
  app.use("/api/messages", messagesRouter()); // driver ↔ dispatch messaging
  app.use("/api/members", membersRouter());
  app.use("/api/auth", authRouter()); // PUBLIC driver-login exchange (its own throttles + uniform errors)
  // Step-up password re-verification (audit P0-4). Behind requireAuth internally; shares the
  // /api/auth strictLimiter above, which is the right budget for a password oracle.
  app.use("/api/auth", authStepUpRouter());
  app.use("/api/roster/drivers", rosterDriversRouter()); // admin-owned driver master data + app enrollment
  app.use("/api/roster/drivers", rosterCredentialsRouter()); // company-issued app logins (DC4)
  app.use("/api/transactions", transactionsRouter());
  app.use("/api/anomalies", anomaliesRouter());
  app.use("/api/reports", reportsRouter());
  app.use("/api/audit", auditRouter());
  app.use("/api/integrations", integrationsRouter());
  app.use("/api/fueling", fuelingRouter());
  // Reads, then writes, then the two admin-only diagnostics. Four routers on one prefix (the
  // rosterDriversRouter precedent), each starting with its own `router.use(requireAuth)` so
  // routeAuth.test.ts discovers "the mounted /api routers" from this line and fails CI if any one forgets it.
  // The write router is mounted after the read one so its `cardWriteLimit()` only ever sees the paths
  // it is meant to meter — a GET never touches the durable counter.
  // ⚠ ONE LINE, deliberately: routeAuth.test.ts discovers mounts with `app\.use\("(\/api\/…)"…Router\(\)\)`
  // and cannot see a call broken across lines. A mount it cannot see is a router whose `requireAuth`
  // nothing checks — the single failure that fitness function exists to make impossible.
  // ⚠ SETTINGS FIRST. fuelCardsRouter declares `GET /:id`, which matches the literal path "settings"
  // and would answer 404 for a card id that was never a card id. Order is the fix; a test asserts it.
  app.use("/api/fuel-cards", fuelCardSettingsRouter(), fuelCardsRouter(), fuelCardControlRouter(), fuelCardProbeRouter(), fuelCardWriteProbeRouter(), fuelCardExperimentsRouter());
  app.use("/api/ai", aiRouter());
  app.use("/api/jobs", jobsRouter());
  app.use("/api/dispatch", dispatchRouter()); // was defined but unmounted on main — wired here
  app.use("/api/public/hazmat", publicHazmatRouter()); // M7: public, unauthenticated calculator + HMT lookup
  app.use("/api/hazmat", hazmatRouter());
  app.use("/api/compliance", complianceRouter()); // temporal compliance master data — certifications feed the §5 gate (M1)
  app.use("/api/driver-app", driverAppSettingsRouter()); // dashboard control plane for the driver app (Phase 5, D-PM6)
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
      if (err instanceof HttpError) {
        res.status(err.status).json(apiError(err.code, err.message));
        return;
      }
      res.status(500).json(apiError("internal_error", "Unexpected server error"));
    }
  });

  return app;
}
