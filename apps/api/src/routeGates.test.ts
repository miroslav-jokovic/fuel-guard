import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";

/**
 * Fitness function — every mounted /api surface carries a ROLE gate somewhere in its stack, or is
 * pinned auth-only with the reason (P4.2, D-SEP10 — the deferred half of the P0.4 gate).
 *
 * The static version of this check was abandoned on purpose: role gates live per-verb inside
 * router trees, and a regex over mount lines pinned genuinely-gated routers (roster, recruiting)
 * as "auth-only" — a ledger that lies. This is the truthful version: it builds the REAL express
 * app and walks the REAL middleware stacks, recognising gates by the `gateKind` marker that
 * requireRole / requireModule / requireFreshAuth now attach to their handlers. A gate the walker
 * cannot see does not exist — which is the point: a new router whose verbs forgot requireRole
 * fails here until it is gated or pinned below with an argument.
 *
 * The finance sections are why this lands now: phase P5's accounting/billing/maintenance routers
 * are born under this check — an ungated money route cannot ship quietly.
 */

// Mounts that are AUTH-ONLY (or public) by design, each with the argument. Shrink-only; a new
// entry is a deliberate, reviewed decision.
const AUTH_ONLY_MOUNTS = new Map<string, string>([
  ["/api/auth", "the login exchange — public by definition; carries its own throttles + uniform errors"],
  ["/api/version", "deploy/migration probe — public deliberately; a version endpoint needing a token is one nobody checks"],
  ["/api/public/hazmat", "the public M7 calculator — anonymous by product design; stateless, no tenant data"],
  ["/api/webhooks", "provider-signed (Samsara HMAC, Twilio signature) — authenticated, just not by a user role"],
  ["/api/tms", "the on-prem agent — authenticated by the org ingest token (hash-matched), a machine credential with no role to check"],
  // R3c-2. Deliberate, and the argument is that there is no capability here to gate. A saved view is
  // a NAME plus a query string belonging to the caller: it grants nothing, reveals nothing, and
  // names no data the reader could not already reach — applying one is a navigation, and the page it
  // navigates to enforces its own permissions exactly as it does for a pasted link. What isolates
  // the rows is that every query filters on BOTH org_id and user_id (asserted in savedViews.test.ts,
  // "lists only the caller's own views, for the table asked for"), plus the RLS policy 0278 puts on
  // the table for PostgREST. A section gate here would invent a capability nobody needs: a recruiter
  // who may read the roster may certainly name a view of it.
  ["/api/saved-views", "a bookmark belonging to the caller — grants nothing and reveals nothing; isolated by org_id + user_id on every query and by 0278's RLS"],
]);

/** Discover mounts from app.ts source — same detector routeAuth.test.ts uses, same reason. */
function mountedApiRouters(): string[] {
  const src = readFileSync(new URL("./app.ts", import.meta.url), "utf8");
  const re = /app\.use\("(\/api\/[^"]+)"\s*,[^\n]*?\w+Router\(\)[^\n]*\)/g;
  return [...new Set([...src.matchAll(re)].map((m) => m[1]!))];
}

type Layer = {
  handle?: ((...args: unknown[]) => unknown) & { gateKind?: string; stack?: Layer[] };
  route?: { stack: Layer[] };
  /** Express 5: layers match via matcher functions, not a regexp. */
  matchers?: Array<(path: string) => unknown>;
};

/** Does any handler in this layer's subtree declare itself a gate? */
function subtreeHasGate(layer: Layer, depth = 0): boolean {
  if (depth > 12) return false;
  const h = layer.handle;
  if (h?.gateKind) return true;
  if (layer.route) return layer.route.stack.some((l) => subtreeHasGate(l, depth + 1));
  const nested = h?.stack;
  if (Array.isArray(nested)) return nested.some((l) => subtreeHasGate(l, depth + 1));
  return false;
}

describe("route role-gate coverage (P4.2)", () => {
  it("every /api mount carries a role/module/step-up gate in its stack, or is pinned with a reason", () => {
    const env = loadEnv({
      ...process.env,
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-key",
      SUPABASE_JWT_SECRET: "test-secret-test-secret-test-secret!!",
    });
    const app = createApp(env);
    // Express 5 keeps the layer stack on app.router (lazily built by the first access).
    const stack: Layer[] = (app as unknown as { router: { stack: Layer[] } }).router.stack;

    const ungated: string[] = [];
    const usedPins = new Set<string>();
    for (const mount of mountedApiRouters()) {
      // every layer whose matcher accepts this mount participates in serving it
      const layers = stack.filter((l) => (l.matchers ?? []).some((m) => Boolean(m(mount))));
      const gated = layers.some((l) => subtreeHasGate(l));
      if (gated) continue;
      const pin = [...AUTH_ONLY_MOUNTS.keys()].find((p) => mount === p || mount.startsWith(`${p}/`));
      if (pin && pin !== "__SEEDED__") {
        usedPins.add(pin);
        continue;
      }
      ungated.push(mount);
    }

    expect(
      ungated,
      `mounts with NO role/module/step-up gate anywhere in their middleware stack — gate a verb or pin here with an argument`,
    ).toEqual([]);

    const stalePins = [...AUTH_ONLY_MOUNTS.keys()].filter((p) => p !== "__SEEDED__" && !usedPins.has(p));
    expect(stalePins, "pinned mounts that are now gated (or gone) — ratchet down").toEqual([]);
  });
});
