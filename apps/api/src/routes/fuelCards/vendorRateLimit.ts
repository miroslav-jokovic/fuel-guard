import type { Request } from "express";

export interface FuelCardRouteSpec {
  method: string;
  path: string;
  opensSoap: boolean;
}

/**
 * A request is charged the vendor budget if and only if its classified route can open a SOAP session.
 * Keep every fuel-card route here, including database-only routes, so adding a route requires an explicit
 * traffic decision instead of silently falling through to an unmetered path. This table proves that a
 * classification decision was made for every route, not that the decision is correct: nothing statically
 * verifies that a route marked `opensSoap: false` cannot reach `getEfsSoapCredentials`. Because this
 * limiter protects a shared vendor account, ambiguity must resolve toward charging.
 */
export const FUEL_CARD_ROUTE_TABLE: readonly FuelCardRouteSpec[] = [
  { method: "GET", path: "/settings", opensSoap: false },
  { method: "PATCH", path: "/settings", opensSoap: false },
  { method: "PUT", path: "/approvers/:userId", opensSoap: false },
  { method: "DELETE", path: "/approvers/:userId", opensSoap: false },
  { method: "GET", path: "/locations", opensSoap: true },
  { method: "GET", path: "/policies/:policyNumber", opensSoap: true },
  { method: "POST", path: "/sync", opensSoap: true },
  { method: "GET", path: "/", opensSoap: false },
  /**
   * Step 6.6. A pure ledger read — it joins `efs_card_mutations` to `efs_cards` and touches no
   * credential, so it never opens a session. Charging it would spend the shared vendor budget on a
   * page somebody leaves open.
   */
  { method: "GET", path: "/mutations", opensSoap: false },
  { method: "GET", path: "/:id", opensSoap: false },
  { method: "POST", path: "/:id/refresh", opensSoap: true },
  { method: "POST", path: "/:id/lock", opensSoap: true },
  { method: "POST", path: "/:id/unlock", opensSoap: true },
  { method: "POST", path: "/:id/override", opensSoap: true },
  { method: "DELETE", path: "/:id/override", opensSoap: true },
  { method: "POST", path: "/:id/prompts", opensSoap: true },
  { method: "POST", path: "/diagnose", opensSoap: true },
  { method: "POST", path: "/write-check", opensSoap: true },
  // Reads the WHOLE account — one getCardSummaries plus one getCardv2 per card in the batch. The
  // heaviest vendor request in the product by a wide margin, and charged accordingly.
  { method: "POST", path: "/echo-scan", opensSoap: true },
  // The one fuel-card route that genuinely cannot reach EFS: the config scan reads the mirror's
  // stored vendor documents and resolves no credentials, so there is no vendor budget to charge
  // and no ambiguity to resolve toward charging. See routes/fuelCards/scan.ts.
  { method: "POST", path: "/config-scan", opensSoap: false },
  // Writes to a real card twice and reads it three times. The heaviest interactive route there is,
  // and charged — the org-cap exemption (migration 0192) is deliberately NOT a vendor-budget
  // exemption: the vendor's rate limit protects WEX, and a proof run is real traffic to them.
  { method: "POST", path: "/prove/:capability", opensSoap: true },
  // Reads two of our own tables and writes one. No vendor call — a promotion is a decision about
  // evidence already gathered, which is exactly why it is a separate endpoint from the proof.
  { method: "POST", path: "/promote/:capability", opensSoap: false },
  { method: "POST", path: "/experiment", opensSoap: true },
  // Step 7.2. Reads the whole ACCOUNT — up to 28 paced calls in one request, and up to 75 more when
  // `sampleCards` is used. Read-only throughout, which is why it needs no probe flag; charged
  // because "read-only" says nothing about vendor budget.
  { method: "POST", path: "/account-inventory", opensSoap: true },
];

const PREFIX = "/api/fuel-cards";

function normalizePath(path: string): string {
  const collapsed = path.replace(/\/+/g, "/");
  if (collapsed === "/") return collapsed;
  return collapsed.replace(/\/+$/, "");
}

function pathMatches(template: string, path: string): boolean {
  const expected = template.split("/");
  const actual = path.split("/");
  return expected.length === actual.length && expected.every((segment, i) => segment.startsWith(":") || segment === actual[i]);
}

function relativePath(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === PREFIX) return "/";
  return normalized.startsWith(`${PREFIX}/`) ? normalized.slice(PREFIX.length) : normalized;
}

function methodMatches(routeMethod: string, requestMethod: string): boolean {
  return routeMethod === requestMethod || (routeMethod === "GET" && requestMethod === "HEAD");
}

function matchedRoute(req: Pick<Request, "method" | "path">): FuelCardRouteSpec | undefined {
  const path = relativePath(req.path);
  return FUEL_CARD_ROUTE_TABLE.find(
    (route) => methodMatches(route.method, req.method) && pathMatches(route.path, path),
  );
}

export function isFuelCardVendorRequest(req: Pick<Request, "method" | "path">): boolean {
  return matchedRoute(req)?.opensSoap === true;
}

/**
 * Skip only an explicitly classified database-only route. Unknown or malformed paths stay charged so a
 * matcher mistake spends one vendor-budget request rather than exposing the shared account to unmetered
 * traffic.
 */
export function skipFuelCardVendorRateLimit(req: Request): boolean {
  const route = matchedRoute(req);
  return route !== undefined && !route.opensSoap;
}

/**
 * The budget protects a shared VENDOR ACCOUNT, and an EFS account is held per org — so the bucket has
 * to be the org, not the caller's IP (Step 5.6). Keyed on IP, two people in one office shared 30
 * requests per quarter-hour across two different EFS accounts, and a QA session spent production's
 * allowance; keyed on the org, neither is possible.
 *
 * `req.auth` is guaranteed here because `app.ts` mounts `requireAuth` AHEAD of this limiter on
 * `/api/fuel-cards`. That ordering is the whole fix and `vendorRateLimit.test.ts` asserts it, in
 * "an unauthenticated request is refused without consuming a vendor slot". Deliberately NOT solved by
 * decoding the JWT here: that would be a second auth implementation (standing rule 5).
 *
 * Two consequences of hoisting it, both wanted. An unauthenticated request is refused with a 401
 * WITHOUT spending a slot of a real org's budget. And every router on that prefix keeps its own
 * `router.use(requireAuth)` — all ten were checked one by one before the hoist — so this ADDS a check
 * rather than moving one: each router stays safe to mount anywhere, and
 * `apps/api/src/routeAuth.test.ts` still discovers them.
 *
 * An authenticated user with no org yet gets their own bucket rather than a shared one. They cannot
 * reach EFS — `requireOrg` answers 403 inside every fuel-card router — but this module resolves
 * ambiguity toward charging, and a shared fallback bucket is the IP bug in a different costume.
 */
export function fuelCardVendorRateLimitKey(req: Request): string {
  const auth = req.auth;
  if (!auth) {
    // Unreachable while the mount order holds. Throwing beats inventing a key: express-rate-limit
    // surfaces it through the error handler as a 500, which is loud, whereas any fallback value
    // silently re-pools unrelated callers into one budget — the exact defect this function fixes.
    throw new Error("fuel-card vendor rate limit reached before requireAuth — check the mount order in app.ts");
  }
  return auth.orgId ? `org:${auth.orgId}` : `user:${auth.userId}`;
}
