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

/**
 * Fitness function — no fuel-section route hand-lists roles (FUEL-T2, D-FUI12).
 *
 * ── WHY THIS EXISTS, AND WHY THE TWO GATES ALREADY BUILT COULD NOT DO IT ─────────────────────────
 * The 2026-08-27 audit already found this: `check-section-policies.mjs`' own header records *"the
 * entire fuel-spend surface hand-listing roles instead of deriving them, and a dispatcher reading
 * fuel spend nobody decided they should read"* (D-SEP10). It was recorded and not closed, and it
 * survived a year because it fell precisely between the two gates that were built for it —
 * `check-section-policies.mjs` checks migration RLS policies above 0260 and grandfathers everything
 * earlier, and the fitness function ABOVE asserts a gate EXISTS and deliberately does not look at
 * which roles it names. A hand-written list is invisible to both.
 *
 * The visible cost, measured 2026-09-01: `accountant` and `auditor` hold `fuel: "view"` in
 * `SECTION_ACCESS`, so the nav offers them Exceptions, the route is `requiresAuth` so the page loads
 * — and the API answered 403, because the list said `admin, fleet_manager, dispatcher`. Three
 * different opinions about one question.
 *
 * ── WHY IT CHECKS THE SOURCE RATHER THAN THE MOUNTED STACK ───────────────────────────────────────
 * Comparing role SETS at runtime would pass a list that happens to be right today: `admin,
 * fleet_manager, dispatcher` is exactly `rolesThatManage("dispatch")`, so a set comparison cannot
 * tell a derived answer from a coincidence. What has to be true is the FORM — the roles are read
 * from the matrix at the call site and never written down beside it — and that is a property of the
 * text. `mountedApiRouters()` above reads app.ts for the same reason.
 *
 * Every `router.<verb>` in these files must be matched, so a route the parser cannot see fails the
 * test rather than passing unexamined.
 */
const FUEL_ROUTE_FILES = [
  "modules/fuel/routes/transactions.ts",
  "modules/fuel/routes/discountRules.ts",
  "modules/fuel-spend/routes/spend.ts",
  "modules/fuel-spend/routes/exceptions.ts",
  "modules/fuel-spend/routes/statements.ts",
  "modules/anomalies/routes/anomalies.ts",
] as const;

/** Which section each file's routes answer to. */
const FILE_SECTION: Record<string, "fuel" | "safety"> = {
  "modules/fuel/routes/transactions.ts": "fuel",
  "modules/fuel/routes/discountRules.ts": "fuel",
  "modules/fuel-spend/routes/spend.ts": "fuel",
  "modules/fuel-spend/routes/exceptions.ts": "fuel",
  "modules/fuel-spend/routes/statements.ts": "fuel",
  "modules/anomalies/routes/anomalies.ts": "safety",
};

/**
 * Routes that legitimately do NOT take their section's derived set. Shrink-only; a new entry is a
 * deliberate, reviewed decision with its argument written here.
 */
const GATE_WAIVERS = new Map<string, string>([
  [
    'modules/anomalies/routes/anomalies.ts post /thresholds',
    'admin-only on purpose and already derived — it mirrors the RLS write policy exactly, per the route\'s own comment (P6.1)',
  ],
  [
    'modules/fuel/routes/discountRules.ts post /discount-rules',
    'admin-only on purpose and already derived — a contract discount rule is an org-configuration act, not a fuel-desk one',
  ],
  // ── Four reads with NO role gate at all. PRE-EXISTING, and deliberately NOT closed by T2. ───────
  // T2's subject is the hand-written LIST; these have no list, they have nothing, so gating them is
  // a NARROWING rather than the widening T2 is. A narrowing removes a capability somebody may be
  // using and belongs to a step that says so out loud — it is recorded as Q-FUI12 in
  // docs/plans/fuel/FUEL-SECTION-CONSOLIDATION-PLAN.md §6 with a recommendation, not fixed in
  // passing here. They are pinned rather than ignored so the next reader finds them.
  [
    'modules/anomalies/routes/anomalies.ts get /:id/risk-context',
    'no role gate — requireOrg only; Q-FUI12',
  ],
  [
    'modules/anomalies/routes/anomalies.ts get /:id/pattern-report',
    'no role gate — requireOrg only; Q-FUI12',
  ],
  [
    'modules/anomalies/routes/anomalies.ts get /:id/history',
    'no role gate — requireOrg only; Q-FUI12',
  ],
  [
    'modules/fuel-spend/routes/statements.ts get /statements/:id/source',
    'no role gate — requireOrg only, and it re-checks the caller org before signing a URL; Q-FUI12',
  ],
]);

const ROUTE_RE = /router\.(get|post|put|patch|delete)\(\s*"([^"]+)"([\s\S]*?)asyncHandler\(/g;

describe("fuel-section route gates derive from SECTION_ACCESS (FUEL-T2, D-FUI12)", () => {
  it("every fuel/anomaly route reads its roles from the matrix — reads the view set, writes the manage set", () => {
    const offenders: string[] = [];
    const usedWaivers = new Set<string>();

    for (const rel of FUEL_ROUTE_FILES) {
      const src = readFileSync(new URL(`./${rel}`, import.meta.url), "utf8");
      const declared = [...src.matchAll(/router\.(?:get|post|put|patch|delete)\(/g)].length;
      const matched = [...src.matchAll(ROUTE_RE)];
      // A route the parser cannot see would be silently exempt, which is how the original finding
      // survived two gates. Refuse to report on a file we could not read completely.
      expect(matched.length, `${rel}: parsed ${matched.length} of ${declared} routes`).toBe(declared);

      for (const m of matched) {
        const [, verb, path, middle] = m as unknown as [string, string, string, string];
        const key = `${rel} ${verb} ${path}`;
        if (GATE_WAIVERS.has(key)) {
          usedWaivers.add(key);
          continue;
        }
        const section = FILE_SECTION[rel]!;
        const wanted = verb === "get" ? `rolesThatCanView("${section}")` : `rolesThatManage("${section}")`;
        if (!middle.includes(`requireRole(...${wanted})`)) {
          const got = /requireRole\(([\s\S]*?)\),/.exec(middle)?.[1]?.trim() ?? "no role gate";
          offenders.push(`${key}\n      wanted requireRole(...${wanted})\n      got    requireRole(${got})`);
        }
      }
    }

    expect(
      offenders,
      "fuel-section routes whose gate is not the matrix's set for their section — derive it, or waive it here with an argument",
    ).toEqual([]);

    const stale = [...GATE_WAIVERS.keys()].filter((k) => !usedWaivers.has(k));
    expect(stale, "waived routes that no longer exist (or are now derived) — ratchet down").toEqual([]);
  });
});
