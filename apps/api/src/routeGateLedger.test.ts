import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { APP_SECTIONS, rolesThatCanView, rolesThatManage } from "@silvicom/shared";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";
import { AUTH_ONLY_MOUNTS, OPEN_ROUTES, ROLE_LIST_WAIVERS } from "./testing/routeLedger.js";

/**
 * Fitness functions — Q-SURF1, the gates an org's permissions page cannot reach
 * (`docs/plans/permissions/SURFACE-ENTITLEMENTS-PLAN.md` S7).
 *
 * ── WHAT WAS ACTUALLY WRONG, MEASURED RATHER THAN COUNTED ───────────────────────────────────────
 * The plan sized this at "~24 hand-written role lists and 65 endpoints with nothing beyond
 * requireAuth", from a static parse of 312 of 321 call sites, and said to treat it as a shape rather
 * than a census. It was right to. Walking the REAL express app finds **351 routes**, of which **39**
 * carry no gate of any kind — and **27 of those sit under mounts already pinned** as public or
 * machine-authenticated (`/api/auth`, `/api/version`, `/api/public/hazmat`, `/api/webhooks`,
 * `/api/tms`, `/api/saved-views` — `/api/tms` alone is seventeen on-prem-agent ingest routes). The
 * genuinely unexamined set was **twelve**, not sixty-five: a static parse cannot see a gate applied
 * through a local const — `const canHire = requireRole(...)` — and counts every route under it as
 * ungated. Three of the twelve are now gated, nine carry an argument in the ledger.
 *
 * The role-list figure held almost exactly: **25** literal `requireRole(...)` lists that are not
 * `requireRole("admin")`. **18 of them equalled a section's derived set** and now call
 * `requireSection`; the remaining 7 are waived with the argument for why their act is not a section
 * question.
 *
 * ── WHY TWO FUNCTIONS AND WHY ONE OF THEM READS SOURCE ──────────────────────────────────────────
 * COVERAGE is a runtime question: a gate applied through a const, a router-level `use`, or a shared
 * middleware is a real gate, and only the built app knows. `routeGates.test.ts` already walks it at
 * MOUNT grain and this one goes per ROUTE, which is where an ungoverned endpoint actually hides — a
 * router with nine gated verbs and one bare one passes the coarser check.
 *
 * FORM is a source question, for FUEL-T2's reason: `admin, fleet_manager, dispatcher` IS
 * `rolesThatManage("dispatch")` today, so comparing SETS cannot tell a derived answer from a
 * coincidence. What has to be true is that the roles are read from the matrix at the call site and
 * never written down beside it, and that is a property of the text.
 */

// ── COVERAGE ─────────────────────────────────────────────────────────────────────────────────────

type Layer = {
  handle?: ((...a: unknown[]) => unknown) & {
    gateKind?: string;
    stack?: Layer[];
    section?: string;
    level?: string;
    specs?: unknown;
  };
  route?: { path?: string; stack: Layer[]; methods?: Record<string, boolean> };
  matchers?: Array<(p: string) => unknown>;
};

/** A handler that declares itself a gate — the marker `requireRole`/`requireSection`/… attach. */
const gateLabel = (h?: Layer["handle"]): string | null =>
  h?.gateKind ? (h.section ? `${h.gateKind}(${h.section}/${h.level})` : h.specs ? "anySection" : h.gateKind) : null;

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
  const src = readFileSync(new URL("./app.ts", import.meta.url), "utf8");
  const re = /app\.use\("(\/api[^"]*)"\s*,[^\n]*?\w+Router\(\)[^\n]*\)/g;
  return [...new Set([...src.matchAll(re)].map((m) => m[1]!))];
}

function everyRoute(): Map<string, string[]> {
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
  return out;
}

describe("every /api ROUTE is gated, or is open with a written argument (S7, Q-SURF1)", () => {
  it("finds no route without a gate that the ledger has not accounted for", () => {
    const routes = everyRoute();
    // A route the walker cannot see would be silently exempt, which is how the 28-route sidebar gap
    // survived: refuse to report on an app that produced implausibly few routes.
    expect(routes.size).toBeGreaterThan(300);

    const unaccounted: string[] = [];
    const usedRoutes = new Set<string>();
    for (const [key, gates] of routes) {
      if (gates.length > 0) continue;
      const path = key.slice(key.indexOf(" ") + 1);
      // A mount pinned as public or machine-authenticated answers for every route beneath it.
      if ([...AUTH_ONLY_MOUNTS.keys()].some((m) => path === m || path.startsWith(`${m}/`))) continue;
      if (OPEN_ROUTES.has(key)) {
        usedRoutes.add(key);
        continue;
      }
      unaccounted.push(key);
    }

    expect(
      unaccounted.sort(),
      "routes with NO role/section/module/step-up gate — gate them, or add them to OPEN_ROUTES with the argument",
    ).toEqual([]);

    const stale = [...OPEN_ROUTES.keys()].filter((k) => !usedRoutes.has(k));
    expect(stale, "ledgered routes that are now gated (or gone) — ratchet down").toEqual([]);
  });

  /**
   * The three routes S7 actually CLOSED, named so the narrowing is a fact in a test rather than a
   * sentence in a commit message.
   *
   * All three backed the Fuel Planning and Truck Stops screens on `requireOrg` alone — the API half
   * of the gap S2 closed at the router. `view` and not `manage`: reading a station price or an
   * address suggestion is not planning a route. Who each level admits is `requireSection`'s own
   * question and is pinned in `middleware/requireSection.test.ts`; what is pinned here is that these
   * three ask it at all.
   */
  it("the three fueling reads S7 closed now ask the dispatch section", () => {
    const routes = everyRoute();
    for (const key of [
      "GET /api/fueling/stations",
      "GET /api/fueling/geocode-suggest",
      "GET /api/fueling/vehicle-location",
    ]) {
      expect(routes.get(key), key).toContain("role(dispatch/view)");
    }
  });
});

// ── FORM ─────────────────────────────────────────────────────────────────────────────────────────

const SRC = fileURLToPath(new URL(".", import.meta.url));

function apiSourceFiles(dir = SRC, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      apiSourceFiles(p, out);
      continue;
    }
    if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * Comments are stripped before scanning, and that is not tidiness: `app.ts` explains a mount ORDER
 * bug by quoting `requireRole("admin", "fleet_manager")` in prose, and a scanner reading raw text
 * reports a gate that does not exist. The same blind spot — a gate greping its own comments — has
 * cost this programme a wrong answer twice (`lint:section-policies`' waiver check, and a
 * `requireSurface` scan that counted a doc comment as a call site).
 */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

interface RoleList {
  file: string;
  roles: string[];
  key: string;
}

function literalRoleLists(): RoleList[] {
  const out: RoleList[] = [];
  for (const file of apiSourceFiles()) {
    const src = stripComments(readFileSync(file, "utf8"));
    for (const m of src.matchAll(/requireRole\(\s*((?:"[a-z_]+"\s*,?\s*)+)\)/g)) {
      const roles = [...m[1]!.matchAll(/"([a-z_]+)"/g)].map((x) => x[1]!);
      // `requireRole("admin")` is not a section question and never can be: D-PERM7 makes the `admin`
      // section ungrantable, so an admin-only gate is not an org's to reach. The 56 of them are
      // correct as they stand and are deliberately out of S7's scope.
      if (roles.length === 1 && roles[0] === "admin") continue;
      const rel = relative(SRC, file);
      out.push({ file: rel, roles, key: `${rel} [${[...roles].sort().join(",")}]` });
    }
  }
  return out;
}

/** Every section's two derived sets, as sorted comma strings — the shape a literal is compared to. */
const derivedSets = new Map<string, string>(
  APP_SECTIONS.flatMap((s) => [
    [[...rolesThatCanView(s)].sort().join(","), `${s}/view`] as const,
    [[...rolesThatManage(s)].sort().join(","), `${s}/manage`] as const,
  ]).map(([set, name]) => [set, name]),
);

describe("no API route hand-lists roles without an argument (S7, Q-SURF1)", () => {
  /**
   * The rule, in one sentence: a literal list of roles is a permission an org's matrix cannot reach.
   *
   * If it EQUALS a section's derived set it is a gate that will stop agreeing with the product the
   * first time an org edits that section — the failure D-PERM3 describes, and the one the fuel-spend
   * surface shipped for a year. If it equals NO section's set it is a rule of some other kind, which
   * may be perfectly right (a driver-app surface, an irreversible act granted by name, a federal
   * confidentiality rule) and has to say so somewhere a reader will look.
   */
  it("every literal multi-role list either derives from the matrix or is waived with its reason", () => {
    const offenders: string[] = [];
    const used = new Set<string>();
    for (const { key, roles } of literalRoleLists()) {
      if (ROLE_LIST_WAIVERS.has(key)) {
        used.add(key);
        continue;
      }
      const match = derivedSets.get([...roles].sort().join(","));
      offenders.push(
        match
          ? `${key}\n      IS ${match} — call requireSection("${match.split("/")[0]}"${match.endsWith("view") ? ', "view"' : ""}) so an org's answer moves it`
          : `${key}\n      matches no section's set — waive it in ROLE_LIST_WAIVERS with the argument`,
      );
    }
    expect(
      offenders.sort(),
      "hand-written role lists — derive them from the matrix, or waive each with its argument",
    ).toEqual([]);

    const stale = [...ROLE_LIST_WAIVERS.keys()].filter((k) => !used.has(k));
    expect(stale, "waived role lists that no longer exist (or now derive) — ratchet down").toEqual([]);
  });
});
