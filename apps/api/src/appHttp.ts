import express, { type Express } from "express";
import compression from "compression";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import type { Env } from "./env.js";
import {
  apiRateLimitKey,
  apiAddressKey,
  API_RATE_LIMIT_PER_CALLER,
  API_RATE_LIMIT_PER_ADDRESS,
} from "./middleware/apiRateLimit.js";

/**
 * The HTTP plumbing `createApp` installs before any route runs: the CSP, and the body parsers.
 *
 * ── WHY THIS FILE EXISTS, AND WHAT DELIBERATELY DID NOT MOVE INTO IT ────────────────────────────
 * `app.ts` reached 503 lines against the 500-line budget (`lint:filesize`) when LM10 added one
 * router mount. Its own header already records why squeezing back under by deleting a comment is
 * the wrong move — it leaves the NEXT router at the same wall with no headroom — so something had
 * to leave, and the choice of what was forced rather than free:
 *
 * ⚠ **The router mounts CANNOT move.** `routeAuth.test.ts`, `routeGates.test.ts` and
 * `routeGateLedger.test.ts` discover every mounted router by reading `app.ts`'s SOURCE and matching
 * `app.use("/api/…", …Router())`. Those fitness functions are the only thing standing between a new
 * router and a route with no authentication, and they would go on passing — covering less — if a
 * mount line moved to another file. `mountFuelCardPrefix` is pinned in `app.ts` for the same reason
 * plus one of its own: `vendorRateLimit.test.ts` asserts the ORDER of the `/api/fuel-cards` mounts.
 *
 * What is here instead is the plumbing that mounts no router at all. `mountBodyParsers` does call
 * `app.use("/api/…", …)`, but with a parser rather than a `…Router()`, so no detector was reading
 * those lines and none stops reading them now.
 */
/**
 * CSP tuned for the single-service deploy where this server also serves the SPA: the browser talks
 * directly to Supabase (REST + realtime websockets + storage images), so those origins must be
 * allowed in connect/img. Harmless for API-only responses (JSON carries no CSP-restricted content).
 */
export function securityMiddleware(env: Env) {
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
        /**
         * ⚠ **Without this the document viewer is a grey box in production and works everywhere
         * else** (2026-09-19, reported by the owner against B2's permissions PDF).
         *
         * `frame-src` has no default of its own — it falls back to `default-src`, which is `'self'`.
         * `DocumentPreview.vue` frames two things and NEITHER is `'self'`: a `blob:` URL for a
         * document the API composes per request (the application preview, B2's signed permissions),
         * and a Supabase signed storage URL for a filed one. Chrome refuses both and paints its own
         * *"This content is blocked. Contact the site owner to fix the issue."* — no console error
         * the page can catch, no network failure, no way for the component to tell.
         *
         * ⚠ **The reason it survived review is that it cannot happen on this machine.** Vite serves
         * the SPA in dev and in `preview:local`, and vite does not run helmet — so the viewer is
         * correct in every local walk and blocked in the one deploy where this server also serves the
         * SPA. Rendering the PDF and looking at it does not find this; only loading the page from a
         * host that sends the header does.
         *
         * ⚠ `blob:` is the same exception `workerSrc` above already carries for maplibre's tile
         * decoder, for the same reason: the bytes never left the page, so the origin is the document
         * itself and there is nothing for an allow-list to name.
         */
        frameSrc: ["'self'", "blob:", "https://*.supabase.co"],
      },
    },
  });
}
/**
 * The three body parsers, in the order they have to be mounted.
 *
 * Extracted from `createApp` when A11b's form parser took it past the 200-line function budget —
 * `mountPublic` below is the same move for the same reason. Order is the whole content of this
 * function: `express.json` skips a body something earlier already parsed, so each narrow parser has
 * to come before the general one, and the general one has to keep the raw bytes for signature checks.
 */
export function mountBodyParsers(app: Express): void {
  // Browser report upload (P0-1): a month of EFS rows as JSON can exceed the general 1mb cap — give
  // ONLY this route a bigger parser (mounted first; express.json skips bodies already parsed).
  app.use("/api/transactions/import-report", express.json({ limit: "25mb" }));
  app.use("/api/transactions/import-preview", express.json({ limit: "25mb" }));
  // A weekly Pilot statement is ~30k positioned words plus the source PDF (~370 KB → ~500 KB base64),
  // which the 1 MB default below rejects. Same exception, same reason, as the import report above.
  app.use("/api/fueling/statements", express.json({ limit: "25mb" }));

  // ⚠ The `express.urlencoded` mount that used to sit here was for Twilio, which posts
  // `application/x-www-form-urlencoded`. Telnyx posts JSON and signs the RAW BYTES, so the parser
  // below is now the only one inbound SMS needs — and the urlencoded mount had to go rather than be
  // left harmless, because it would have consumed the stream ahead of the `verify` hook and left
  // `rawBody` undefined for a form-encoded request, which the route reads as unverifiable (A11b).

  // Capture the exact raw body so provider webhooks (Samsara HMAC, Telnyx Ed25519) can be verified
  // byte-for-byte against what was actually sent.
  app.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
}

/**
 * Compress API responses (C2, `docs/plans/livemap/LIVE-MAP-CONCURRENCY-PLAN.md`).
 *
 * ── WHY, MEASURED ───────────────────────────────────────────────────────────────────────────────
 * Nothing compressed anything before this. The live map's board is **68.4 KB** on the wire and a
 * board of that shape gzips **93% smaller** (77.7 → 5.7 KB modelled), because it is 171 near-identical
 * JSON objects — the most compressible thing this product sends. At the 30 dispatchers C1 exists to
 * support, polling every 5 s, that is **27.3 MB/min of egress instead of 2.0**.
 *
 * It is not only the map. Every list endpoint in the product has the same shape, so this is the one
 * line here that helps a page nobody has profiled yet.
 *
 * ── MOUNTED HIGH, ABOVE THE ROUTERS AND THE STATIC SPA ──────────────────────────────────────────
 * `compression` works by wrapping `res.write`/`res.end`, so it only affects responses written by
 * handlers registered AFTER it. Directly under `cors` means it covers the API, the SPA's own assets
 * and the history fallback, and it sits below `securityMiddleware` so a refused request is still
 * refused before anything is encoded.
 *
 * ⚠ THE TILE PROXY IS DELIBERATELY UNAFFECTED, AND THAT IS NOT LUCK. `compression` consults
 * `compressible(content-type)`, which is false for `image/png` and `image/jpeg` — so a basemap tile
 * passes through untouched. That matters because the tile route was just changed to STREAM its body
 * (B2, #853): re-encoding an already-compressed photograph would have spent CPU to make it bigger
 * and re-buffered the stream to do it.
 *
 * ⚠ BREACH, SAID OUT LOUD RATHER THAN INHERITED. Compressing authenticated responses gives an
 * attacker who can both influence a response's content and observe its size a way to guess a secret
 * in that same response. It is accepted here, deliberately: this API takes its credential from the
 * `Authorization` header rather than a cookie, and reflects no session secret, CSRF token or API key
 * into a response body — so there is no secret in the compressed stream to size-oracle. If a route
 * ever does echo one back, it must opt out (`res.setHeader("Cache-Control", …)` is not enough — use
 * `compression`'s `filter`), and that is a decision to record here rather than discover later.
 */
export function mountCompression(app: Express): void {
  app.use(compression());
}

/**
 * The general `/api` budget — two limiters, mounted ahead of every body parser.
 *
 * ── THE ORDERING IS THE OLD FIX, AND IT STAYS (audit M8, 2026-08-09 finding 3.8) ─────────────────
 * These used to sit BELOW the body parsers, which meant an unauthenticated POST to
 * /api/transactions/import-report was buffered and JSON.parsed at up to 25 MB BEFORE the limiter ran
 * — the 429 was returned after the cost had already been paid, on the single service that also
 * serves the SPA. Middleware runs in registration order, so where this is called from is the whole
 * fix. It must stay above `mountBodyParsers`.
 *
 * ── C1: IT IS TWO LIMITERS NOW, AND THE CHEAP CHECK RUNS FIRST ───────────────────────────────────
 * It was one 600/IP/15 min bucket, which every dispatcher in an office shared — measured, 30 of them
 * were hard-refused 100.1 seconds after opening the live map and stayed refused for the rest of the
 * window. `middleware/apiRateLimit.ts` carries the measurement and the sizing of both numbers.
 *
 * The address ceiling runs first because it is a map lookup on an address the socket already knows;
 * the per-caller bucket hashes a header, so it is the dearer of the two.
 *
 * ⚠ Extracted from `createApp` rather than inlined because it took that function to 207 lines, past
 * the 200-line budget `lint:funcsize` enforces. Same shape as `mountPublic` and `mountFuelCardPrefix`
 * above — a named stage, called in order.
 */
export function mountGeneralRateLimits(app: Express): void {
  const apiAddressCeiling = rateLimit({
    windowMs: 15 * 60_000,
    limit: API_RATE_LIMIT_PER_ADDRESS,
    keyGenerator: apiAddressKey,
    // The per-caller limiter owns the `RateLimit` headers. Two limiters both writing draft-7 headers
    // would leave a client reading whichever ran last, which is the less informative of the two — a
    // dispatcher wants to know about THEIR budget, not their office's.
    standardHeaders: false,
    legacyHeaders: false,
  });
  app.use("/api", apiAddressCeiling);

  const apiLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: API_RATE_LIMIT_PER_CALLER,
    keyGenerator: apiRateLimitKey,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  });
  app.use("/api", apiLimiter);
}

