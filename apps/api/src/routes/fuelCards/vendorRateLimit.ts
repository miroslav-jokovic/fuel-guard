import type { Request } from "express";

export interface FuelCardRouteSpec {
  method: string;
  path: string;
  opensSoap: boolean;
}

/**
 * A request is charged the vendor budget if and only if it can open a SOAP session. Keep every fuel-card
 * route here, including database-only routes, so adding a route requires an explicit traffic decision
 * instead of silently falling through to an unmetered path.
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
  { method: "POST", path: "/experiment", opensSoap: true },
];

const PREFIX = "/api/fuel-cards";

function pathMatches(template: string, path: string): boolean {
  const expected = template.split("/");
  const actual = path.split("/");
  return expected.length === actual.length && expected.every((segment, i) => segment.startsWith(":") || segment === actual[i]);
}

function relativePath(path: string): string {
  if (path === PREFIX) return "/";
  return path.startsWith(`${PREFIX}/`) ? path.slice(PREFIX.length) : path;
}

function methodMatches(routeMethod: string, requestMethod: string): boolean {
  return routeMethod === requestMethod || (routeMethod === "GET" && requestMethod === "HEAD");
}

export function isFuelCardVendorRequest(req: Pick<Request, "method" | "path">): boolean {
  const path = relativePath(req.path);
  return FUEL_CARD_ROUTE_TABLE.some(
    (route) => route.opensSoap && methodMatches(route.method, req.method) && pathMatches(route.path, path),
  );
}

/** Express-rate-limit skip predicate: only database-only card routes fall through to the general API budget. */
export function skipFuelCardVendorRateLimit(req: Request): boolean {
  return !isFuelCardVendorRequest(req);
}
