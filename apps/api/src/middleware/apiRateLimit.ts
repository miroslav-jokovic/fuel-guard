import { createHash } from "node:crypto";
import type { Request } from "express";
import { ipKeyGenerator } from "express-rate-limit";

/**
 * How the general `/api` budget is divided between callers (C1,
 * `docs/plans/livemap/LIVE-MAP-CONCURRENCY-PLAN.md`).
 *
 * ── THE DEFECT THIS FIXES, MEASURED ──────────────────────────────────────────────────────────────
 * The general limiter was `600 per 15 minutes` keyed by IP, which is express-rate-limit's default.
 * `trust proxy` is 1, so that is the caller's real address — and **every dispatcher in one office
 * shares one address**. The live map polls every 5 s, so one dispatcher spends `900 / 5 = 180`
 * requests per window on polling alone, and tiles come out of the same budget because
 * `/api/fueling/map-tiles/:z/:x/:y` is under `/api`:
 *
 *   | dispatchers on one office IP | polls / 15 min | |
 *   | 3  |   540 | 90% of the budget |
 *   | 4  |   720 | refused          |
 *   | 30 | 5 400 | refused after 100 s |
 *
 * Measured on a rig driving the real app at 30 concurrent dispatchers: **first 429 at 100.1 s**
 * against a predicted 100.0, then 149 refusals in the next 20 seconds, and the bucket stays empty
 * for the remaining ~13 minutes. That is legitimate traffic being refused, not throttled — the map
 * goes blank for the whole office at once with nothing in the product to explain it.
 *
 * The same rig showed the application itself is nowhere near its limit: 30 users at 59.8 ms p50 /
 * 68.7 ms p95, still flat at 100 users, event-loop lag under 3 ms, and production's positions query
 * at 0.749 ms. Only the bucket was too small, and only because it was shared.
 *
 * ── WHY A TOKEN AND NOT A USER ID, WHICH IS THE OBVIOUS ANSWER ───────────────────────────────────
 * `fuelCardVendorRateLimitKey` keys its budget on `req.auth.orgId`, and solves the "auth has not run
 * yet" problem by hoisting `requireAuth` AHEAD of the limiter on `/api/fuel-cards`. **That option is
 * not open here.** `/api` also carries the routes that must work with no credential at all — the
 * driver login exchange on `/api/auth`, `/api/public/*`, `/api/version` — so a `requireAuth` hoisted
 * across the whole prefix would lock out the surfaces whose whole job is to be reachable.
 *
 * ⚠ AND IT IS DELIBERATELY NOT A JWT DECODE. That module's comment states the standing rule: keying
 * by decoding the token here "would be a second auth implementation". This does not decode anything.
 * It hashes the credential as an **opaque string** and uses the digest as a bucket label — no claims
 * are read, no signature is checked, and nothing here decides what a caller may do. A forged token
 * gets its own bucket and then a 401 from the real gate, which is why the ceiling below exists.
 *
 * ⚠ It is HASHED rather than used directly because a bearer token is a credential, and a rate-limit
 * key is a map key that outlives the request and can end up in a store dump. The digest is
 * one-way and truncated; two requests bearing the same token still collide, which is the only
 * property needed.
 *
 * ⚠ A refreshed token opens a NEW bucket. That is a loosening rather than a tightening — the worst
 * case is a caller getting a fresh allowance early — and it is bounded by the address ceiling.
 * Sessions refresh on the order of an hour, not on the order of a 5-second poll.
 */

/**
 * Per-caller budget, per 15 minutes.
 *
 * Sized from measured behaviour rather than picked: a dispatcher with the board open spends 180
 * requests on polling, and the map's own tile traffic was measured at 9 tiles per camera move
 * (median, worst 45) — so a busy quarter-hour on the heaviest surface in the product is ~600. 1 200
 * is twice that, which leaves the limiter doing its job against a runaway client while never
 * reaching a person doing their work.
 */
export const API_RATE_LIMIT_PER_CALLER = 1_200;

/**
 * Coarse per-ADDRESS ceiling, per 15 minutes — the backstop that makes the per-caller key safe.
 *
 * Without it, anybody could mint random `Authorization` headers and hand themselves an unbounded
 * number of buckets. Those requests are cheap (the limiter is mounted ahead of the body parsers, and
 * a forged token is a 401 from `requireAuth`) but "cheap" is not "free".
 *
 * Sized for the office this plan exists to support — 30 seats × the ~600 a busy seat actually
 * spends — so it cannot be reached by people working, and it still holds a single flooding address
 * to ~20 requests a second. It is NOT `30 × API_RATE_LIMIT_PER_CALLER`: the ceiling is sized on
 * measured usage, the per-caller budget on headroom, and multiplying the two would compound the
 * safety margin into no ceiling at all.
 *
 * ⚠ This is the app layer, and app-layer flood protection is a backstop, never the main line — the
 * edge is. What this genuinely buys is that one address cannot spend everybody else's database.
 */
export const API_RATE_LIMIT_PER_ADDRESS = 18_000;

/** Enough of a SHA-256 to make a collision between two live sessions not a thing that happens. */
const DIGEST_CHARS = 32;

/**
 * The bucket a request counts against: its bearer credential when it has one, its address otherwise.
 *
 * ⚠ The unauthenticated branch keeps the OLD behaviour on purpose. Public traffic has no identity
 * but its address, and those surfaces — the login exchange, public invites, the hazmat calculator —
 * are the actual abuse targets. They each carry their own tighter limiter as well (`strictLimiter`
 * at 30/15 min on `/api/auth`, `calcLimiter` on `/api/public`), which is what makes it safe for this
 * general one to become a fairness limit between colleagues rather than a wall in front of them.
 */
export function apiRateLimitKey(req: Request): string {
  const header = req.get("authorization");
  const bearer = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) {
    return `tok:${createHash("sha256").update(bearer).digest("hex").slice(0, DIGEST_CHARS)}`;
  }
  // `ipKeyGenerator` rather than `req.ip` directly: it collapses an IPv6 address to its /64 prefix,
  // so a caller cannot walk their own subnet for a fresh bucket per request.
  return `ip:${ipKeyGenerator(req.ip ?? "")}`;
}

/** The address ceiling counts every request from an address, credentialled or not. */
export function apiAddressKey(req: Request): string {
  return `addr:${ipKeyGenerator(req.ip ?? "")}`;
}
