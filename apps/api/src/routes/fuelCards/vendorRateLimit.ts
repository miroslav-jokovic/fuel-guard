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
  { method: "GET", path: "/:id", opensSoap: false },
  { method: "POST", path: "/:id/refresh", opensSoap: true },
  { method: "POST", path: "/:id/lock", opensSoap: true },
  { method: "POST", path: "/:id/unlock", opensSoap: true },
  { method: "POST", path: "/:id/override", opensSoap: true },
  { method: "DELETE", path: "/:id/override", opensSoap: true },
  { method: "POST", path: "/:id/prompts", opensSoap: true },
  { method: "GET", path: "/:id/history", opensSoap: false },
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
