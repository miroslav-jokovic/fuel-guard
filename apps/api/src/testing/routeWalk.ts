import { createApp } from "../app.js";
import { loadEnv } from "../env.js";
import { readFileSync } from "node:fs";

/**
 * The walk of the REAL express app's routes, with the gates standing in front of each — moved here from
 * `routeGateLedger.test.ts` (S7, Q-SURF1) on 2026-11-05 so a second reader of the same question (the ads
 * route ledger, Security L3: `modules/ads/security/adsRouteGates.test.ts`) derives its route list from the
 * one walk rather than restating it. Nothing in the walk changed; its reasoning stays in the ledger's header.
 */

export type Layer = {
  handle?: ((...a: unknown[]) => unknown) & {
    gateKind?: string;
    stack?: Layer[];
    section?: string;
    level?: string;
    specs?: unknown;
    adminOnly?: string;
    roles?: string[];
  };
  route?: { path?: string; stack: Layer[]; methods?: Record<string, boolean> };
  matchers?: Array<(p: string) => unknown>;
};

/**
 * A handler that declares itself a gate — the marker `requireRole`/`requireSection`/… attach.
 * `adminOnly(<key>)` for a named admin-only act (SP11) and `role[<roles>]` for a role list, so the
 * SP11 checks below can tell a named grant from a bare `requireRole("admin")`.
 */
export const gateLabel = (h?: Layer["handle"]): string | null => {
  if (!h?.gateKind) return null;
  if (h.section) return `${h.gateKind}(${h.section}/${h.level})`;
  if (h.specs) return "anySection";
  if (h.adminOnly) return `adminOnly(${h.adminOnly})`;
  if (h.roles) return `${h.gateKind}[${[...h.roles].sort().join(",")}]`;
  return h.gateKind;
};

/** Every route reachable under `prefix`, with the gates that stand in front of it. */
function walkRoutes(stack: Layer[], prefix: string, inherited: string[], out: Map<string, string[]>): void {
  const pending = [...inherited];
  for (const layer of stack) {
    if (layer.route) {
      const gates = [...pending];
      for (const l of layer.route.stack) {
        const g = gateLabel(l.handle);
        if (g) gates.push(g);
      }
      const methods = Object.keys(layer.route.methods ?? {}).join(",").toUpperCase();
      out.set(`${methods} ${prefix}${layer.route.path ?? ""}`, gates);
      continue;
    }
    const g = gateLabel(layer.handle);
    // A gate mounted with `router.use` guards everything declared after it in the same router.
    if (g) {
      pending.push(g);
      continue;
    }
    if (Array.isArray(layer.handle?.stack)) walkRoutes(layer.handle.stack, prefix, pending, out);
  }
}

/** Discover mounts from app.ts source — the same detector routeGates.test.ts uses, same reason. */
function mountedApiRouters(): string[] {
  const src = readFileSync(new URL("../app.ts", import.meta.url), "utf8");
  // A router factory may take its dependencies (`adsRouter({ briefSourcesFor })`, `drugAlcoholRouter({ … })`):
  // matching only an empty `Router()` made both mounts invisible here, every route under them unaudited
  // (found 2026-11-04, Track S S1b, when /api/ads gained an argument and its admin-only keys went "unused").
  const re = /app\.use\("(\/api[^"]*)"\s*,[^\n]*?\w+Router\([^\n]*\)/g;
  return [...new Set([...src.matchAll(re)].map((m) => m[1]!))];
}

export function everyRoute(): Map<string, string[]> {
  const env = loadEnv({
    ...process.env,
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-key",
    SUPABASE_JWT_SECRET: "test-secret-test-secret-test-secret!!",
  });
  const app = createApp(env);
  const stack: Layer[] = (app as unknown as { router: { stack: Layer[] } }).router.stack;
  const out = new Map<string, string[]>();
  for (const mount of mountedApiRouters()) {
    for (const layer of stack) {
      if (layer.route) continue;
      if (!(layer.matchers ?? []).some((m) => Boolean(m(mount)))) continue;
      if (Array.isArray(layer.handle?.stack)) walkRoutes(layer.handle.stack, mount, [], out);
    }
  }
  /**
   * ⚠ And the routes declared straight on the app rather than inside a mounted router. There is one
   * — `GET /api/me` — and it is the identity every page bootstraps from, which is exactly the kind of
   * endpoint a walker that only looked at mounts would never report. `mountedApiRouters()` reads
   * `app.use(...)` lines, so an `app.get("/api/…")` is invisible to it by construction.
   */
  walkRoutes(
    stack.filter((l) => typeof l.route?.path === "string" && l.route.path.startsWith("/api")),
    "",
    [],
    out,
  );
  return out;
}
