import express, { type Express } from "express";
import helmet from "helmet";
import type { Env } from "./env.js";

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