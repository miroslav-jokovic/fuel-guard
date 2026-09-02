#!/usr/bin/env node
/**
 * Fitness function — the surface catalogue is ONE home, and it stays one
 * (SURFACE-ENTITLEMENTS-PLAN.md S1, D-SURF3).
 *
 * `SURFACES` in `packages/shared` answers "which permission does this screen need". Three consumers
 * read it: the sidebar (S1), the router guard (S2) and the API (S3). The catalogue is only worth
 * having while nothing drifts away from it, and three things can:
 *
 *   1. A CATALOGUED PATH THAT IS NOT A REAL ROUTE. A surface nobody can reach is a permission an
 *      admin can grant that does nothing — the worst kind, because the page reads as if it worked.
 *      Checked against `routeTable.test.ts.snap`, which is generated from the LIVE router rather
 *      than parsed out of the route files. Three hand-written regex parsers were tried while
 *      measuring this plan and each was wrong in a different way; the snapshot is ground truth.
 *
 *   2. AN ICON MAP THAT HAS DRIFTED FROM THE CATALOGUE. Icons cannot live in shared — it depends on
 *      zod alone and is compiled for React Native for `apps/driver` — so they live in
 *      `apps/web/src/lib/navIcons.ts`. That split is the exact point where an author concludes the
 *      catalogue "can't live in shared" and duplicates it. Both directions are checked: an icon
 *      without a surface, and a nav surface without an icon (which would render a blank glyph).
 *
 *   3. A SURFACE WHOSE LEVEL EXCEEDS ITS SECTION. `level: "manage"` on a section no role manages is
 *      a dead entry; a `parent` that names no surface breaks D-SURF8's inheritance silently.
 *
 * It PARSES the catalogue's own literal rather than importing it, for the reason every other gate in
 * this repo does: a gate that needs the workspace built cannot run before the build. Parse failure
 * IS failure — a detector that silently matches nothing is worse than no detector.
 *
 * `--self-test` proves all five detectors fire.
 */
import { readFileSync, readdirSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const CATALOGUE = `${ROOT}packages/shared/src/surfaces.ts`;
const ICONS = `${ROOT}apps/web/src/lib/navIcons.ts`;
const ROUTE_SNAPSHOT = `${ROOT}apps/web/src/router/__snapshots__/routeTable.test.ts.snap`;
const AUTH = `${ROOT}packages/shared/src/auth.ts`;
const API_SRC = `${ROOT}apps/api/src`;

/**
 * Every declared route, read from the snapshot the live router produces, with the two facts this
 * gate needs: is it a redirect, and is it reachable without a session?
 */
export function routeRecords(snapshot) {
  const block = snapshot.split("> route table 1`] = `")[1];
  if (!block) throw new Error("route-table snapshot block not found — the gate cannot check routes; fix the parser with the test");
  const out = [];
  for (const m of block.matchAll(/\{\s*"meta": \{([\s\S]*?)\},\s*"name": ([\s\S]*?),\s*"path": "([^"]*)",\s*"redirect": ([^,]*),\s*\}/g)) {
    const [, meta, , path, redirect] = m;
    out.push({ path, meta, redirect: redirect.trim() !== "null" });
  }
  if (out.length < 50) throw new Error(`route snapshot parse found only ${out.length} routes — parser or snapshot shape changed; fix together`);
  return out;
}

/** Every declared route path, read from the snapshot the live router produces. */
export function routePaths(snapshot) {
  const block = snapshot.split("> route table 1`] = `")[1];
  if (!block) throw new Error("route-table snapshot block not found — the gate cannot check paths; fix the parser with the test");
  const paths = [...block.matchAll(/^\s*"path": "([^"]*)",$/gm)].map((m) => m[1]);
  if (paths.length < 50) throw new Error(`route snapshot parse found only ${paths.length} paths — parser or snapshot shape changed; fix together`);
  return new Set(paths);
}

/** The catalogue's entries, parsed from its literal. */
export function surfaces(src) {
  const block = src.match(/export const SURFACES: readonly Surface\[\] = \[([\s\S]*?)\n\];/);
  if (!block) throw new Error("SURFACES literal not found in surfaces.ts — gate cannot check anything; fix the parser with the file");
  const out = [];
  for (const line of block[1].split("\n")) {
    const key = line.match(/\{\s*key:\s*"([^"]+)"/)?.[1];
    if (!key) continue;
    out.push({
      key,
      path: line.match(/path:\s*"([^"]*)"/)?.[1],
      group: line.match(/group:\s*"([^"]+)"/)?.[1],
      parent: line.match(/parent:\s*"([^"]+)"/)?.[1] ?? null,
      section: line.match(/gate:\s*(?:section|manage)\("(\w+)"/)?.[1] ?? null,
      level: /gate:\s*manage\(/.test(line) ? "manage" : /gate:\s*section\(/.test(line) ? "view" : null,
      kind: /gate:\s*ALWAYS/.test(line) ? "always" : /gate:\s*STAFF/.test(line) ? "staff" : /gate:\s*ADMIN/.test(line) ? "admin" : "section",
    });
  }
  if (out.length < 20) throw new Error(`SURFACES parse found only ${out.length} entries — parser or literal shape changed; fix together`);
  return out;
}

/** The icon map's keys. */
export function iconKeys(src) {
  const block = src.match(/export const SURFACE_ICONS: Record<string, Icon> = \{([\s\S]*?)\n\};/);
  if (!block) throw new Error("SURFACE_ICONS literal not found in navIcons.ts — gate cannot check the split; fix the parser with the file");
  return new Set([...block[1].matchAll(/^\s*"?([\w.-]+)"?:/gm)].map((m) => m[1]));
}

/** Roles that can manage / view each section, from the auth.ts matrix. */
function matrix(src) {
  const block = src.match(/const SECTION_ACCESS[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (!block) throw new Error("SECTION_ACCESS literal not found in auth.ts — gate cannot check levels; fix the parser with the file");
  const m = {};
  for (const row of block[1].matchAll(/^\s*(\w+):\s*\{([^}]*)\},?\s*$/gm))
    for (const c of row[2].matchAll(/(\w+):\s*"(none|view|manage)"/g)) (m[c[1]] ??= {})[row[1]] = c[2];
  if (Object.keys(m).length < 8) throw new Error(`SECTION_ACCESS parse found only ${Object.keys(m).length} sections — fix the parser with the matrix`);
  return m;
}

/**
 * Routes that are authenticated but deliberately NOT surfaces. Each needs a reason, because the
 * alternative to this list is the gate being switched off, and a waiver nobody can read is the same
 * thing with extra steps.
 */
const UNCATALOGUED_WAIVERS = {
  // A ROLE test, not a section question. D-PERM7 makes the `admin` section ungrantable, so there is
  // no matrix cell these could ever read — `requiresAdmin` is the only honest gate for them.
  "/settings/org": "requiresAdmin — role test, no section to read",
  "/settings/notifications": "requiresAdmin — role test",
  "/settings/thresholds": "requiresAdmin — role test",
  "/settings/driver-performance": "requiresAdmin — role test",
  "/settings/fuel-planning": "requiresAdmin — role test",
  "/settings/efs-soap": "requiresAdmin — role test",
  "/settings/card-control": "requiresAdmin — role test",
  "/settings/permissions": "requiresAdmin — role test; it is the page that EDITS the matrix",
  // admin OR the read-only reviewer — an intersection the section matrix cannot express.
  "/settings/audit": "requiresAuditAccess — admin or readOnly, not a section",
  // Not a permission surface: the guard sends every driver here before any section check runs, and
  // it is the one page a driver may see.
  "/use-the-app": "the driver redirect; reached BEFORE any section gate, by construction",
};

/** Every `requireSurface("key")` in the API, with the file that wrote it. */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*/gm, "");

export function requireSurfaceKeys(files) {
  const out = [];
  for (const { path, src: raw } of files) {
    // Comments FIRST, on check-capabilities.mjs's precedent: this middleware's own header names
    // `requireSurface("maintenance.inspectors")` as its worked example, and counting a comment as a
    // call site would make the gate's own tally a number nobody could reconcile.
    const src = stripComments(raw);
    for (const m of src.matchAll(/requireSurface\(\s*"([^"]+)"\s*\)/g)) {
      // `requireSurface("${key}")` inside the middleware's own error message is not a call site.
      // Skipping INTERPOLATED strings rather than skipping the file keeps a real call in
      // requireSurface.ts visible, which excluding the file by name would not.
      if (m[1].includes("${")) continue;
      out.push({ path, key: m[1] });
    }
  }
  return out;
}

export function findViolations({ cat, icons, routes, sections, authRoutes = null, apiGates = null }) {
  const errors = [];
  const keys = new Set(cat.map((s) => s.key));
  const navKeys = new Set(cat.filter((s) => !s.parent).map((s) => s.key));

  for (const s of cat) {
    if (!routes.has(s.path))
      errors.push(`surface "${s.key}" has path ${s.path}, which is not a declared route — a permission that grants nothing.`);
    if (s.parent && !keys.has(s.parent))
      errors.push(`surface "${s.key}" names parent "${s.parent}", which is not a surface (D-SURF8 inheritance would silently do nothing).`);
    if (s.kind === "section") {
      const roles = sections[s.section];
      if (!roles) errors.push(`surface "${s.key}" gates on section "${s.section}", which is not in SECTION_ACCESS.`);
      else if (s.level === "manage" && !Object.values(roles).includes("manage"))
        errors.push(`surface "${s.key}" needs manage on "${s.section}", which no role manages — a dead entry.`);
    }
  }
  for (const k of navKeys) if (!icons.has(k)) errors.push(`nav surface "${k}" has no icon in navIcons.ts — it would render blank.`);
  for (const k of icons) if (!navKeys.has(k)) errors.push(`navIcons.ts has an icon for "${k}", which is not a nav surface — the split has drifted.`);

  /**
   * Every authenticated route is a surface, or is waived by name (S2). Without this the catalogue
   * covers whatever it happened to cover on the day it was written, and the NEXT route added is the
   * 29th with a hidden menu entry and a working URL — which is the defect this plan measured 28
   * times over. The guard falls through to `true` for an uncatalogued route on purpose, so this
   * check is what stops that fallthrough becoming a hole.
   */
  if (authRoutes) {
    const paths = new Set(cat.map((s) => s.path));
    for (const path of authRoutes) {
      if (paths.has(path) || path in UNCATALOGUED_WAIVERS) continue;
      errors.push(`route ${path} needs a session but is not a surface — catalogue it, or waive it by name in UNCATALOGUED_WAIVERS with a reason.`);
    }
    for (const path of Object.keys(UNCATALOGUED_WAIVERS)) {
      if (!authRoutes.includes(path))
        errors.push(`UNCATALOGUED_WAIVERS names ${path}, which is no longer an authenticated route — drop the waiver.`);
      else if (paths.has(path))
        errors.push(`UNCATALOGUED_WAIVERS names ${path}, which IS catalogued — the waiver reads as "not covered" and is not; drop it.`);
    }
  }
  /**
   * D-SURF5: an endpoint may only claim a surface the catalogue defines. A typo'd key gates on a
   * screen that does not exist, and `surfaceAllowed` answers `true` for it — an open door that reads
   * as a closed one. `requireSurface` throws at construction too; this is what catches it in review
   * rather than at boot.
   */
  if (apiGates) {
    const keys = new Set(cat.map((s) => s.key));
    for (const g of apiGates)
      if (!keys.has(g.key))
        errors.push(`${g.path}: requireSurface("${g.key}") names no surface in the catalogue — the gate would never close.`);
  }
  return errors;
}

function selfTest() {
  const routes = new Set(["/real", "/parent"]);
  const sections = { fuel: { admin: "manage", auditor: "view" }, ghost: { admin: "view" } };
  const cases = [
    [[{ key: "a", path: "/nope", kind: "staff" }], new Set(["a"]), /not a declared route/],
    [[{ key: "a", path: "/real", kind: "staff", parent: "missing" }], new Set(), /not a surface/],
    [[{ key: "a", path: "/real", kind: "section", section: "nowhere", level: "view" }], new Set(["a"]), /not in SECTION_ACCESS/],
    [[{ key: "a", path: "/real", kind: "section", section: "ghost", level: "manage" }], new Set(["a"]), /no role manages/],
    [[{ key: "a", path: "/real", kind: "staff" }], new Set(), /has no icon/],
    [[{ key: "a", path: "/real", kind: "staff" }], new Set(["a", "stale"]), /split has drifted/],
  ];
  const fails = [];
  for (const [cat, icons, expected] of cases) {
    const found = findViolations({ cat, icons, routes, sections });
    if (!found.some((e) => expected.test(e))) fails.push(`detector did not fire for ${expected}: got ${JSON.stringify(found)}`);
  }
  // The two route-coverage detectors, which need the extra argument.
  const uncat = findViolations({
    cat: [{ key: "a", path: "/real", kind: "staff" }], icons: new Set(["a"]), routes, sections,
    authRoutes: ["/real", "/orphan"],
  });
  if (!uncat.some((e) => /\/orphan needs a session but is not a surface/.test(e)))
    fails.push(`detector did not fire for an uncatalogued authenticated route: ${JSON.stringify(uncat)}`);
  const stale = findViolations({
    cat: [{ key: "a", path: "/real", kind: "staff" }], icons: new Set(["a"]), routes, sections,
    authRoutes: ["/real", ...Object.keys(UNCATALOGUED_WAIVERS).slice(0, 1)],
  });
  if (!stale.some((e) => /no longer an authenticated route/.test(e)))
    fails.push(`detector did not fire for a stale waiver: ${JSON.stringify(stale)}`);
  const badGate = findViolations({
    cat: [{ key: "a", path: "/real", kind: "staff" }], icons: new Set(["a"]), routes, sections,
    apiGates: [{ path: "x.ts", key: "not.a.surface" }],
  });
  if (!badGate.some((e) => /names no surface in the catalogue/.test(e)))
    fails.push(`detector did not fire for a bad requireSurface key: ${JSON.stringify(badGate)}`);

  const redundant = findViolations({
    cat: [{ key: "a", path: Object.keys(UNCATALOGUED_WAIVERS)[0], kind: "staff" }],
    icons: new Set(["a"]), routes: new Set([Object.keys(UNCATALOGUED_WAIVERS)[0]]), sections,
    authRoutes: [Object.keys(UNCATALOGUED_WAIVERS)[0]],
  });
  if (!redundant.some((e) => /IS catalogued/.test(e)))
    fails.push(`detector did not fire for a redundant waiver: ${JSON.stringify(redundant)}`);

  // A clean catalogue must produce nothing — a gate that always fires is a gate nobody keeps.
  const clean = findViolations({
    cat: [{ key: "a", path: "/real", kind: "section", section: "fuel", level: "manage" }],
    icons: new Set(["a"]), routes, sections,
  });
  if (clean.length) fails.push(`false positive on a clean catalogue: ${JSON.stringify(clean)}`);
  return fails;
}

if (process.argv.includes("--self-test")) {
  const fails = selfTest();
  if (fails.length) { for (const f of fails) console.error(`✗ self-test: ${f}`); process.exit(1); }
  console.log("✓ surfaces self-test — all nine detectors fire, and none fires on a clean catalogue.");
  process.exit(0);
}

const cat = surfaces(readFileSync(CATALOGUE, "utf8"));
const icons = iconKeys(readFileSync(ICONS, "utf8"));
const snapshot = readFileSync(ROUTE_SNAPSHOT, "utf8");
const routes = routePaths(snapshot);
/** Authenticated = a real route that is not a redirect and does not opt out of the session. */
const authRoutes = routeRecords(snapshot)
  .filter((r) => !r.redirect && !/"public"/.test(r.meta) && !/"allowNoOrg"/.test(r.meta))
  .map((r) => r.path);
const sections = matrix(readFileSync(AUTH, "utf8"));

/** Walk the API source for `requireSurface(...)` call sites. */
function apiFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...apiFiles(p));
    else if (e.name.endsWith(".ts") && !e.name.includes(".test.")) out.push({ path: p.slice(ROOT.length), src: readFileSync(p, "utf8") });
  }
  return out;
}
const apiGates = requireSurfaceKeys(apiFiles(API_SRC));

const errors = findViolations({ cat, icons, routes, sections, authRoutes, apiGates });
if (errors.length) {
  console.error(`✗ ${errors.length} surface-catalogue violation(s):`);
  for (const e of errors) console.error(`   ${e}`);
  process.exit(1);
}
console.log(
  `✓ surfaces ok — ${cat.length} surfaces (${cat.filter((s) => !s.parent).length} in the sidebar, ` +
    `${cat.filter((s) => s.parent).length} detail routes) all resolve to real routes; ` +
    `${icons.size} icons match the nav surfaces exactly; ` +
    `all ${authRoutes.length} authenticated routes are catalogued or waived; ` +
    `${apiGates.length} requireSurface gates name real screens.`,
);
