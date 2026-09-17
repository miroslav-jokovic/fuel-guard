import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express, type Request, type Response, type NextFunction, type RequestHandler } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import * as Sentry from "@sentry/node";
import { APP_NAME, type UserRole, type SurfaceClaim } from "@silvicom/shared";
import type { Env } from "./env.js";
import { securityMiddleware, mountBodyParsers, mountCompression, mountGeneralRateLimits } from "./appHttp.js";
import { setAppLocals } from "./lib/appLocals.js";
import { getSupabaseAdmin } from "./lib/supabaseAdmin.js";
import { apiError, asyncHandler } from "./lib/http.js";
import { getBuildInfo } from "./lib/buildInfo.js";
import { getSchemaStatus } from "./lib/schemaVersion.js";
import { requireAuth } from "./middleware/auth.js";
import { requestMetrics } from "./middleware/requestMetrics.js";
import { errorResponder } from "./middleware/errorResponder.js";
import { registerAllHandlers } from "./queue/handlers/index.js";
import { invitesRouter, publicInvitesRouter, sectionAccessRouter, surfaceAccessRouter, surfaceClaimFor } from "./modules/org/index.js";
import { displayNameFor } from "./lib/memberLabels.js";
import { membersRouter } from "./modules/org/index.js";
import { dashboardLayoutRouter, savedViewsRouter } from "./modules/org/index.js";
import { transactionsRouter } from "./modules/fuel/index.js";
import { anomaliesRouter } from "./modules/anomalies/index.js";
import { reportsRouter, aiRouter } from "./modules/insights/index.js";
import { iftaRouter } from "./modules/ifta/index.js";
import { accountingRouter } from "./modules/accounting/index.js";
import { billingRouter } from "./modules/billing/index.js";
import { maintenanceRouter } from "./modules/maintenance/index.js";
import { tagsRouter } from "./tags/routes.js";
import { registerTagResolvers } from "./tags/resolvers.js";
import { auditRouter } from "./modules/org/index.js";
import { integrationsRouter } from "./routes/integrations.js";
import { tmsRosterMasterRouter } from "./modules/mcleod/index.js";
import { fuelingRouter } from "./routes/fueling.js";
import { fuelCardCapabilityRouter } from "./modules/efs/router.js";
import { fuelCardEchoScanRouter } from "./modules/efs/routes/echoScan.js";
import { fuelCardConfigScanRouter } from "./modules/efs/routes/scan.js";
import { fuelCardProveRouter } from "./modules/efs/routes/prove.js";
import { fuelCardPromoteRouter } from "./modules/efs/routes/promote.js";
import { fuelCardExperimentsRouter } from "./modules/efs/routes/experiments.js";
import { fuelCardProbeRouter } from "./modules/efs/routes/probe.js";
import { fuelCardInventoryRouter } from "./modules/efs/routes/inventory.js";
import { fuelCardUnitMileageRouter } from "./modules/efs/routes/unitMileage.js";
import { fuelCardSettingsRouter } from "./modules/efs/routes/settings.js";
import { fuelCardWriteProbeRouter } from "./modules/efs/routes/writeProbe.js";
import { fuelCardsRouter } from "./modules/efs/routes/read.js";
import { fuelCardVendorRateLimitKey, skipFuelCardVendorRateLimit } from "./modules/efs/routes/vendorRateLimit.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { samsaraWebhookBootWarning } from "./modules/samsara/index.js";
import { tmsIngestRouter } from "./modules/mcleod/index.js";
import { jobsRouter } from "./modules/org/index.js";
import { dispatchRouter } from "./modules/loads/index.js";
import { liveMapRouter } from "./modules/livemap/index.js";
import { hazmatRouter } from "./modules/hazmat/index.js";
import { publicHazmatRouter } from "./modules/hazmat/index.js";
import { publicApplicationRouter } from "./modules/recruiting/index.js";
import { complianceRouter } from "./modules/evidence/index.js";
import { driverAppSettingsRouter } from "./modules/driver-app/index.js";
import { meRouter } from "./modules/driver-app/index.js";
import { meHazmatRouter } from "./modules/hazmat/index.js";
import { notificationsRouter } from "./modules/messaging/index.js";
import { messagesRouter } from "./modules/messaging/index.js";
import { rosterDriversRouter } from "./modules/roster/index.js";
import { recruitmentRouter } from "./modules/recruiting/index.js";
import { rosterCredentialsRouter } from "./modules/roster/index.js";
import { rosterArchiveRouter } from "./modules/roster/index.js";
import { rosterSevenDayRouter } from "./modules/roster/index.js";
import { authRouter } from "./routes/auth.js";
import { authStepUpRouter } from "./routes/authStepUp.js";
import { versionRouter } from "./routes/version.js";

/**
 * Everything that guards `/api/fuel-cards`, before the routers on that prefix run.
 *
 * ── Step 5.10: the web host stops pretending it can reach EFS ───────────────────────────────────
 * Two Railway services run this same image. Only `fleetguardapi` is whitelisted by WEX; the web
 * service serves the SPA plus a full, identical copy of the API whose egress WEX's firewall refuses.
 * Every fuel-card route therefore EXISTS on the web host and every one fails there — as a vendor
 * `NotAllowed`, which reads like an entitlement problem with the account rather than a request that
 * arrived at the wrong building.
 *
 * With `EFS_ROUTES_ENABLED=false` the whole prefix answers a routing refusal and the routers below
 * are never reached (this handler terminates; it never calls `next()`). Their mount line is left
 * exactly as it is on purpose — `apps/api/src/routeAuth.test.ts` discovers mounts by scanning this
 * file's source, and making that line conditional would hide ten routers from the fitness function
 * that exists to prove they are authenticated, case by case, in
 * "rejects unauthenticated %s with 401".
 *
 * 503 and not 404: the route is real and the caller is not wrong about it existing, the deployment
 * is wrong about where they sent it. The message names the host that can serve it.
 *
 * ── Step 5.6: `requireAuth` before the limiter ──────────────────────────────────────────────────
 * The vendor budget is keyed on the org whose EFS account it protects, so the key needs `req.auth`.
 * See `fuelCardVendorRateLimitKey`.
 */
function mountFuelCardPrefix(app: Express, env: Env, vendorLimiter: RequestHandler): void {
  if (!env.EFS_ROUTES_ENABLED) {
    app.use("/api/fuel-cards", (_req: Request, res: Response) => {
      res.status(503).json(apiError(
        "efs_routes_not_served_here",
        "Fuel-card operations are served only by the API host, which is the address WEX has whitelisted. "
          + "This host cannot reach EFS.",
      ));
    });
    return;
  }
  app.use("/api/fuel-cards", requireAuth, vendorLimiter);
}

/**
 * The two unauthenticated surfaces, mounted together so the risk they share is stated once.
 *
 * Both answer requests from nobody. The hazmat calculator persists nothing and reasons about
 * chemicals; the application intake accepts a date of birth, a licence number and possibly a Social
 * Security number, so it takes a tighter bucket of its own. A 256-bit token is not guessable at 20
 * tries a minute or at 20 million — the limit is what stops a leaked link being replayed at volume
 * while it is still live, and what keeps an anonymous caller from mapping the surface.
 */
function mountPublic(app: Express): void {
  app.use("/api/public/hazmat", publicHazmatRouter());
  // The invitation link's redemption (2026-09-04): the token in the body is the credential, and a
  // person redeeming one has no account yet. Same bucket as the application intake, for the same
  // reason — it bounds replay of a leaked link, not guessing. ⚠ Limiter on its own line and the
  // mount on ONE line: routeAuth.test.ts / routeGates.test.ts discover mounts from this source and
  // cannot see a call broken across lines; both pin this prefix as public by design.
  app.use("/api/public/invites", rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false }));
  app.use("/api/public/invites", publicInvitesRouter());
  app.use(
    "/api/public/application",
    rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false }),
    publicApplicationRouter(),
  );
}

/** The P5 finance sections — split out of createApp at the 200-line function budget. The
 *  routeAuth/routeGates detectors read app.ts SOURCE for `app.use("/api/…", …Router())` lines,
 *  so the mounts keep that exact shape here. */
function mountFinanceRouters(app: express.Express): void {
  app.use("/api/accounting", accountingRouter());
  app.use("/api/billing", billingRouter());
  app.use("/api/maintenance", maintenanceRouter());
  /**
   * D-INV7's one resolve endpoint. It sits OUTSIDE the maintenance module because §2.10 makes it
   * product-wide — a future `document` or `invite` kind belongs to other sections — and it is
   * mounted here beside the module whose two kinds are the only ones registered today.
   */
  app.use("/api/tags", tagsRouter());
}

/**
 * Every `/api/*` router, mounted in one place.
 *
 * Split out of `createApp` at R3c-2, because adding the saved-views router took that function to
 * 201 lines against the 200-line budget (`lint:funcsize`), and the gate's own instruction is to
 * split into an orchestrator plus stage helpers. Squeezing back under by deleting a comment would
 * have left the NEXT router to hit the same wall with no headroom at all.
 *
 * ⚠ The mounts must stay in THIS FILE's source. `routeAuth.test.ts` discovers every mounted router
 * by reading app.ts and matching `app.use("/api/…", …Router())`, and that fitness function is the
 * only thing standing between a new router and a route with no authentication. Moving these lines
 * to another module would make it silently stop covering them.
 */
function mountApiRouters(app: Express, env: Env): void {
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
  // The per-org permission overrides (D-PERM1). Admin-only inside the router; every write audits.
  app.use("/api/section-access", sectionAccessRouter());
  app.use("/api/surface-access", surfaceAccessRouter());
  // A bookmark belonging to the caller — no role gate; see the router's header.
  app.use("/api/saved-views", savedViewsRouter());
  // The caller's own Dashboard arrangement (LM10, D-DW3). A preference, not a permission, so it sits
  // beside saved views rather than beside the two access routers above: no role gate, no audit row.
  app.use("/api/dashboard-layout", dashboardLayoutRouter());
  app.use("/api/auth", authRouter()); // PUBLIC driver-login exchange (its own throttles + uniform errors)
  // Step-up password re-verification (audit P0-4). Behind requireAuth internally; shares the
  // /api/auth strictLimiter above, which is the right budget for a password oracle.
  app.use("/api/auth", authStepUpRouter());
  app.use("/api/roster/drivers", rosterDriversRouter()); // admin-owned driver master data + app enrollment
  app.use("/api/recruitment", recruitmentRouter()); // applicants, releases, PSP records, and the hire
  // ⚠ ORDER IS LOAD-BEARING between these two. `rosterCredentialsRouter` carries a ROUTER-LEVEL
  // `requireRole("admin", "fleet_manager")` (credentials.ts:48), and an Express sub-router's `use`
  // middleware runs for EVERY request that reaches its mount path — including ones matching none of
  // its routes. Mounted first, it 403s a recruiter's archive request before the archive router is
  // ever consulted. Archiving must therefore be mounted ABOVE it. Caught by
  // `archive.test.ts`'s "passes the door for recruiter", which failed for exactly this reason.
  app.use("/api/roster/drivers", rosterArchiveRouter()); // archive/un-archive a roster row (0235)
  // Mounted above credentials for the same reason archive is — see the note there.
  app.use("/api/roster/drivers", rosterSevenDayRouter()); // §395.8(j)(2) statements (0236)
  app.use("/api/roster/drivers", rosterCredentialsRouter()); // company-issued app logins (DC4)
  app.use("/api/transactions", transactionsRouter());
  app.use("/api/anomalies", anomaliesRouter());
  app.use("/api/reports", reportsRouter());
  app.use("/api/ifta", iftaRouter());
  mountFinanceRouters(app);
  app.use("/api/audit", auditRouter());
  app.use("/api/integrations", integrationsRouter());
  // Same base, its own file: routes/integrations.ts is pinned at 831 lines by lint:filesize.
  app.use("/api/integrations", tmsRosterMasterRouter());
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
  // fuelCardCapabilityRouter is the generated one and serves EVERY card write, one route per
  // capability in the registry (Step 3.7 deleted the hand-written control router; its history read
  // moved into fuelCardsRouter, where a GET belongs).
  // ⚠ fuelCardUnitMileageRouter joins settings AHEAD of fuelCardsRouter, for the same reason:
  // `GET /:id` matches the literal path "unit-mileage" and would answer 404 for a card id that
  // never was one. Its POST is safe anywhere, but the pair belongs together.
  app.use("/api/fuel-cards", fuelCardSettingsRouter(), fuelCardUnitMileageRouter(), fuelCardsRouter(), fuelCardCapabilityRouter(env), fuelCardProbeRouter(), fuelCardWriteProbeRouter(), fuelCardExperimentsRouter(), fuelCardEchoScanRouter(), fuelCardConfigScanRouter(), fuelCardProveRouter(), fuelCardPromoteRouter(), fuelCardInventoryRouter());
  app.use("/api/ai", aiRouter());
  app.use("/api/jobs", jobsRouter());
  app.use("/api/dispatch", dispatchRouter()); // was defined but unmounted on main — wired here
  app.use("/api/livemap", liveMapRouter()); // the dispatcher's board (LM6) — gated dispatch:view
  mountPublic(app); // M7 hazmat calculator + H5 application intake — both unauthenticated
  app.use("/api/hazmat", hazmatRouter());
  app.use("/api/compliance", complianceRouter()); // temporal compliance master data — certifications feed the §5 gate (M1)
  app.use("/api/driver-app", driverAppSettingsRouter()); // dashboard control plane for the driver app (Phase 5, D-PM6)
  // A receiver that fails closed is indistinguishable from one nobody is calling — both are silence.
  // Say it at boot instead of leaving it to be measured six months later (SAMSARA-COLLECTION-PLAN S1).
  const samsaraWebhookWarning = samsaraWebhookBootWarning(env);
  if (samsaraWebhookWarning) console.warn(samsaraWebhookWarning);
  app.use("/api/webhooks", webhooksRouter()); // provider-signed; no user auth
}

/**
 * Build the Express app. Factory with no side effects so tests can construct it freely and inject
 * app.locals.verifyToken to bypass real JWKS verification.
 */
export function createApp(env: Env): Express {
  const app = express();
  setAppLocals(app, { env });
  registerAllHandlers(); // queue handlers available for dispatchJob (both execution modes)
  registerTagResolvers(); // D-INV7's kind → resolver map, on the queue registry's model
  app.set("trust proxy", 1); // Railway runs behind a proxy

  /**
   * ⚠ FIRST, ABOVE EVERY LIMITER AND EVERY ROUTER. A limiter that refuses a request answers it and
   * returns, so a metrics middleware mounted below one counts none of the refusals — and counting
   * 429s is most of why C7 exists, since C1 shipped only because nobody could see them.
   *
   * Pinned by "counts a refusal, which is the thing nobody could see", which fails along with three
   * others when this line is moved below `mountApiRouters`. That test's own comment records the one
   * ordering it does not separately hold, and why.
   */
  app.use(requestMetrics());
  app.use(securityMiddleware(env));
  app.use(cors({ origin: env.ALLOWED_ORIGINS, credentials: true }));
  mountCompression(app);

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

  mountGeneralRateLimits(app);

  mountBodyParsers(app);

  const strictLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  });
  const fuelCardVendorLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: skipFuelCardVendorRateLimit,
    // Step 5.6: the bucket is the ORG whose EFS account the budget protects, never the caller's IP.
    keyGenerator: fuelCardVendorRateLimitKey,
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
  mountFuelCardPrefix(app, env, fuelCardVendorLimiter);
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

  /**
   * Current principal from the verified JWT (org/role may be null until membership exists), plus the
   * org's SCREEN entitlements for this caller's role.
   *
   * ⚠ Why the surfaces travel here and NOT in the token, when sections do (D-SURF4). Sections must be
   * a claim: RLS reads them per row, and `auth_section()` has to inline — this repo has the measured
   * number for breaking that, 128x, and the outage it caused. Nothing in RLS reads a SURFACE, so
   * putting them in the token would buy nothing and cost the one thing the claim costs: a permission
   * change that lands up to an hour later, when `jwt_expiry` is 3600. Served from here, a screen
   * change lands on the next page load.
   *
   * The web calls this in `session.init()`, which the router guard already awaits, so the guard reads
   * the answer synchronously and there is no window where a route resolves against a stale one.
   */
  app.get("/api/me", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.auth!.orgId;
    /**
     * ⚠ The screen answers must NEVER be able to break this endpoint. `/api/me` is the identity the
     * web bootstraps from, and it answered before surfaces existed; a Supabase-admin misconfiguration
     * turning it into a 500 would take the whole app down for a permissions refinement. That is not
     * hypothetical: written without this guard, it broke
     * "/api/me returns the principal for a valid token" in `middleware/auth.test.ts` immediately.
     *
     * Falling back to `{}` is the same fail-OPEN `surfaceClaimFor` documents, applied one layer out
     * where `getSupabaseAdmin` itself can throw. It is safe for the same reason: a surface answer may
     * only NARROW within a section (D-SURF2), so no answer is the shipped catalogue and never more.
     */
    let surfaces: SurfaceClaim = {};
    if (orgId) {
      try {
        surfaces = await surfaceClaimFor(
          getSupabaseAdmin(env),
          orgId,
          req.auth!.role as UserRole | null,
          req.auth!.userId,
        );
      } catch {
        surfaces = {};
      }
    }
    // The caller's display name (0301), fail-open for the reason `displayNameFor` states: a courtesy
    // on the bootstrap path must never be the thing that takes sign-in down. The try is around the
    // CLIENT too — `getSupabaseAdmin` itself can throw, and the first draft left it outside and broke
    // "/api/me returns the principal for a valid token" exactly as the surfaces guard above predicted.
    let fullName: string | null;
    try {
      fullName = await displayNameFor(getSupabaseAdmin(env), req.auth!.userId, orgId, req.auth!.role);
    } catch {
      fullName = null;
    }
    res.json({
      userId: req.auth!.userId,
      email: req.auth!.email,
      fullName,
      orgId,
      role: req.auth!.role,
      surfaces,
    });
  }));

  mountApiRouters(app, env);

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
  app.use(errorResponder);

  return app;
}
