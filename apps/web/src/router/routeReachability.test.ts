import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Fitness function — every page a person can reach is a page something LINKS to (R8).
 *
 * ── WHY R8 NEEDED THIS RATHER THAN A ONE-OFF OPINION ────────────────────────────────────────────
 * R8 asks whether R4–R7 made any surface redundant, and the honest 2026-08-31 answer was "no" — but
 * that answer decays the moment a page loses its last inbound link, which is exactly what happens
 * when a step like R7 moves work somewhere else. The failure is silent: the route still resolves, the
 * component still builds, the page is simply unreachable except by typing the URL, and nobody
 * notices for a year.
 *
 * `routeTable.test.ts` next door asks "does every declared route still resolve to the same
 * component" — the reverse question. This one asks whether anybody can GET there.
 *
 * ── WHAT COUNTS AS A LINK, AND WHAT THE FIRST DRAFT GOT WRONG ───────────────────────────────────
 * Either the PATH or the route NAME, anywhere in `src` outside the router. The first version looked
 * for paths only and produced nine hits, of which eight were its own fault: five were REDIRECTS —
 * which exist precisely so an old bookmark keeps working, so having no in-app link is their entire
 * purpose — and three more were reached by `router.push({ name: "load-new" })` or arrived at from
 * outside the app. Only one was real.
 *
 * That ratio is the argument for verifying a detector against the codebase before trusting it: a
 * check with 89% false positives does not get read, it gets skipped.
 *
 * Parameterised routes are exempt: `/drivers/:id` is reached by constructing the id, and that
 * construction is what the page it came from is for.
 */
const WEB_SRC = path.join(process.cwd(), "src");

/**
 * Routes with no in-app link BY DESIGN, each with the reason. Shrink-only: an entry here is a claim
 * that a URL is meant to be arrived at from outside the app.
 */
const ARRIVED_AT_FROM_OUTSIDE = new Map<string, string>([
  ["/login", "the unauthenticated entry point"],
  ["/accept-invite", "arrived at from an emailed invite link"],
  ["/apply/:token", "the applicant's own emailed link — parameterised anyway"],
  ["/pending", "where the router sends a session with no membership yet"],
  ["/use-the-app", "where the router sends a driver-role session"],
  ["/error", "G1's dead end — navigated to by the error boundary, not linked"],
  ["/maintenance", "G1's dead end — shown when the API is down"],
  // M7. Public, unauthenticated and deliberately INDEXABLE — it is reached from a search result, and
  // the in-app calculator the sidebar points at is `/hazmat/calculator`, a different route.
  ["/placard-calculator", "the public M7 calculator — arrived at from outside the app by design"],
  // `/__design-system` is deliberately absent: it is unshifted onto the table in `router/index.ts`
  // rather than declared in `router/routes/*`, so this file never sees it and an exemption for it
  // would be the stale entry the third assertion below exists to catch.
]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|vue)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) out.push(p);
  }
  return out;
}

interface DeclaredRoute {
  path: string;
  /** The route's `name`, when it has one — `router.push({ name })` is a link this check must see. */
  name: string | null;
  /** A redirect is reached by bookmark BY DESIGN; an in-app link would defeat the point. */
  redirect: boolean;
}

/** Every declared route, read from the route files rather than from a built router. */
function declaredRoutes(): DeclaredRoute[] {
  const dir = path.join(WEB_SRC, "router/routes");
  const out: DeclaredRoute[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts") && !n.includes(".test."))) {
    const src = readFileSync(path.join(dir, f), "utf8");
    // Each `{ … }` route object, from its `path:` to the next one.
    const parts = src.split(/(?=\bpath:\s*")/).slice(1);
    for (const part of parts) {
      const p = part.match(/^path:\s*"([^"]+)"/)?.[1];
      if (!p) continue;
      const head = part.slice(0, 400);
      out.push({
        path: p,
        name: head.match(/\bname:\s*"([^"]+)"/)?.[1] ?? null,
        redirect: /\bredirect:/.test(head),
      });
    }
  }
  return out;
}

const corpus = sourceFiles(WEB_SRC)
  .filter((p) => !p.includes(`${path.sep}router${path.sep}routes${path.sep}`))
  .map((p) => readFileSync(p, "utf8"))
  .join("\n");

const quoted = (needle: string) =>
  corpus.includes(`"${needle}"`) || corpus.includes(`'${needle}'`) || corpus.includes(`\`${needle}\``);

describe("every page is reachable from somewhere", () => {
  const declared = declaredRoutes();

  it("finds the route table, so this cannot pass by scanning nothing", () => {
    expect(declared.length).toBeGreaterThan(40);
    expect(declared.map((r) => r.path)).toContain("/drivers");
    // …and it distinguishes the two kinds, or the redirect exemption below means nothing.
    expect(declared.some((r) => r.redirect)).toBe(true);
    expect(declared.some((r) => r.name)).toBe(true);
  });

  it("has no page that nothing links to", () => {
    const orphans = declared
      .filter((r) => !r.redirect)
      .filter((r) => !r.path.includes(":") && r.path !== "/" && !r.path.includes("*"))
      .filter((r) => !ARRIVED_AT_FROM_OUTSIDE.has(r.path))
      .filter((r) => !quoted(r.path) && !(r.name && quoted(r.name)))
      .map((r) => r.path);

    expect(orphans, "declared, resolvable, and reachable only by typing the URL").toEqual([]);
  });

  it("keeps the deliberate exemptions honest — every one is still a declared route", () => {
    // An exemption for a path that no longer exists is how the next real orphan gets waved through,
    // which is the reasoning `check-feature-boundaries.mjs` records about its own allow-list.
    const paths = new Set(declared.map((r) => r.path));
    const stale = [...ARRIVED_AT_FROM_OUTSIDE.keys()].filter((p) => !paths.has(p));
    expect(stale, "exemptions for routes that no longer exist — ratchet down").toEqual([]);
  });
});
