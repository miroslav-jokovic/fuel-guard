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
 *   4. A DIRECTORY SCREEN OR A STARTING DEFAULT THAT CANNOT DO WHAT IT SAYS (SP1). A `reachedFrom`
 *      naming no nav surface is a screen with no door; a `startsOnFor` on a screen nobody can answer
 *      for (a child, or a non-section gate) is a default that is really a lock, and one naming a
 *      role that does not exist silently starts off for everybody.
 *
 * It PARSES the catalogue's own literal rather than importing it, for the reason every other gate in
 * this repo does: a gate that needs the workspace built cannot run before the build. Parse failure
 * IS failure — a detector that silently matches nothing is worse than no detector.
 *
 * Since LM9 it checks a SECOND catalogue the same way — `DASHBOARD_WIDGETS` and its web-side
 * component registry (D-DW4) — because the failure mode is identical and so is the remedy.
 *
 * `--self-test` proves every detector fires.
 */
import { readFileSync, readdirSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
// ⚠ The CATALOGUE is `surfaceCatalogue.ts`, not `surfaces.ts` — they split on 2026-09-18 (Q-HM8)
// when the combined file hit its 500-line budget. This gate PARSES the file rather than importing
// it (a gate needing the workspace built cannot run before the build), so the path and the data
// have to move together. `surfaces.ts` keeps the types and the gate functions and has no entries.
const CATALOGUE = `${ROOT}packages/shared/src/surfaceCatalogue.ts`;
const ICONS = `${ROOT}apps/web/src/lib/navIcons.ts`;
const ROUTE_SNAPSHOT = `${ROOT}apps/web/src/router/__snapshots__/routeTable.test.ts.snap`;
const AUTH = `${ROOT}packages/shared/src/auth.ts`;
const API_SRC = `${ROOT}apps/api/src`;
/** LM9's widget catalogue, its web-side component registry, and the tab catalogue they render into. */
const WIDGETS = `${ROOT}packages/shared/src/dashboardWidgets.ts`;
const WIDGET_COMPONENTS_FILE = `${ROOT}apps/web/src/lib/dashboardWidgets.ts`;
const TABS = `${ROOT}apps/web/src/features/dashboard/dashboardTabs.ts`;
const CONSTANTS = `${ROOT}packages/shared/src/constants.ts`;
const ENTITLEMENTS = `${ROOT}packages/shared/src/entitlements.ts`;

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
  if (!block) throw new Error("SURFACES literal not found in surfaceCatalogue.ts — gate cannot check anything; fix the parser with the file");
  const out = [];
  for (const line of block[1].split("\n")) {
    const key = line.match(/\{\s*key:\s*"([^"]+)"/)?.[1];
    if (!key) continue;
    out.push({
      key,
      path: line.match(/path:\s*"([^"]*)"/)?.[1],
      group: line.match(/group:\s*"([^"]+)"/)?.[1],
      parent: line.match(/parent:\s*"([^"]+)"/)?.[1] ?? null,
      reachedFrom: line.match(/reachedFrom:\s*"([^"]+)"/)?.[1] ?? null,
      // `null` when absent — which is not the same as `[]`, "starts off for every editable role".
      startsOnFor: /startsOnFor:/.test(line)
        ? [...(line.match(/startsOnFor:\s*\[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1])
        : null,
      section: line.match(/gate:\s*(?:section|manage)\("(\w+)"/)?.[1] ?? null,
      level: /gate:\s*manage\(/.test(line) ? "manage" : /gate:\s*section\(/.test(line) ? "view" : null,
      kind: /gate:\s*ALWAYS/.test(line) ? "always" : /gate:\s*STAFF/.test(line) ? "staff" : /gate:\s*ADMIN/.test(line) ? "admin" : /gate:\s*directory\(/.test(line) ? "directory" : "section",
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
  // ⚠ Nine `/settings/*` routes were waived here until SP1 (SETTINGS-PERMISSIONS-PLAN.md) as "a role
  // test, no section to read". The owner ruled every one of them a permission on 2026-09-30
  // (Q-SET1..3), so each is a catalogued surface now — the four kept admin-only by an `ADMIN` gate,
  // the rest by a section plus `startsOnFor`. A waiver here is a screen an admin cannot be offered.
  //
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

export function findViolations({ cat, icons, routes, sections, roles = null, authRoutes = null, apiGates = null }) {
  const errors = [];
  const keys = new Set(cat.map((s) => s.key));
  const navKeys = new Set(cat.filter((s) => !s.parent && !s.reachedFrom).map((s) => s.key));

  for (const s of cat) {
    if (!routes.has(s.path))
      errors.push(`surface "${s.key}" has path ${s.path}, which is not a declared route — a permission that grants nothing.`);
    if (s.parent && !keys.has(s.parent))
      errors.push(`surface "${s.key}" names parent "${s.parent}", which is not a surface (D-SURF8 inheritance would silently do nothing).`);
    if (s.reachedFrom && !navKeys.has(s.reachedFrom))
      errors.push(`surface "${s.key}" is reachedFrom "${s.reachedFrom}", which is not a sidebar surface — a screen with no door.`);
    // The owner's "hide Settings too" (2026-09-30): a directory is shown when a screen behind it is,
    // so a screen reached from a plain sidebar entry would be a door that opens by a different rule
    // from the one on the card — and a directory nothing names is an entry nobody, the admin
    // included, can ever see.
    if (s.reachedFrom && navKeys.has(s.reachedFrom) && cat.find((d) => d.key === s.reachedFrom)?.kind !== "directory")
      errors.push(`surface "${s.key}" is reachedFrom "${s.reachedFrom}", which is not a directory() gate — its door would not follow its grant.`);
    if (s.kind === "directory" && !cat.some((c) => c.reachedFrom === s.key))
      errors.push(`surface "${s.key}" is a directory that no screen is reachedFrom — it can never be shown.`);
    if (s.reachedFrom && s.parent)
      errors.push(`surface "${s.key}" has both a parent and reachedFrom — it either shares a grant (D-SURF8) or has its own, not both.`);
    if (s.startsOnFor && (s.parent || s.kind !== "section"))
      errors.push(`surface "${s.key}" has startsOnFor but nobody can answer for it (a child, or a non-section gate) — a default no admin could change is a lock.`);
    for (const r of s.startsOnFor ?? [])
      if (roles && !roles.has(r)) errors.push(`surface "${s.key}" starts on for "${r}", which is not a UserRole — it would start off for everybody.`);
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

/**
 * D-DW4 — the widget catalogue is gate-backed on the day it ships.
 *
 * A catalogue without a gate drifts, and this repo has the receipt: `nav.ts` hand-listed its entries
 * until S1, and 28 URLs stayed reachable for roles whose menu entry was hidden. `DASHBOARD_WIDGETS`
 * is a second catalogue with a second web-side half, so it gets the same treatment on day one rather
 * than after the first thing goes missing.
 */
export function widgets(src) {
  const block = src.match(/export const DASHBOARD_WIDGETS: readonly DashboardWidget\[\] = \[([\s\S]*?)\n\];/);
  if (!block) throw new Error("DASHBOARD_WIDGETS literal not found — the gate cannot check anything; fix the parser with the file");
  const out = [];
  for (const line of block[1].split("\n")) {
    const key = line.match(/key:\s*"([^"]+)"/)?.[1];
    if (!key) continue;
    out.push({
      key,
      tab: line.match(/tab:\s*"([^"]+)"/)?.[1] ?? null,
      section: line.match(/gate:\s*(?:section|manage)\("(\w+)"/)?.[1] ?? null,
      module: line.match(/module:\s*"([^"]+)"/)?.[1] ?? null,
      // A column count (`span: 5`) or the one word `"workspace"` — v3 made the width a number (Q-FO3).
      span: (() => { const m = line.match(/span:\s*(?:"([^"]+)"|(\d+))/); return m ? (m[1] ?? Number(m[2])) : null; })(),
      defaultFor: [...(line.match(/defaultFor:\s*\[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]),
    });
  }
  if (out.length === 0) throw new Error("widget parse found nothing — parser or catalogue shape changed; fix together");
  return out;
}

/** The keys of the web-side `Record<key, Component>`. */
export function widgetComponentKeys(src) {
  const block = src.match(/export const WIDGET_COMPONENTS: Record<string, Component> = \{([\s\S]*?)\n\};/);
  if (!block) throw new Error("WIDGET_COMPONENTS literal not found — the icon-style split cannot be checked; fix the parser with the file");
  return new Set([...block[1].matchAll(/^\s*"([^"]+)":/gm)].map((m) => m[1]));
}

/** Tab keys, from the web app's own catalogue (LM-T). */
export function tabKeys(src) {
  const block = src.match(/export const DASHBOARD_TABS: readonly DashboardTab\[\] = \[([\s\S]*?)\n\];/);
  if (!block) throw new Error("DASHBOARD_TABS literal not found; fix the parser with the file");
  return new Set([...block[1].matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]));
}

/** A `["a", "b"] as const` literal by name — USER_ROLES, MODULE_KEYS. */
export function stringArray(src, name) {
  const block = src.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const;`));
  if (!block) throw new Error(`${name} literal not found; fix the parser with the file`);
  return new Set([...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
}

export function findWidgetViolations({ list, components, tabs, sections, roles, modules }) {
  const errors = [];
  const seen = new Set();
  for (const w of list) {
    if (seen.has(w.key)) errors.push(`widget "${w.key}" is declared twice — a key is what LM10 stores a layout against.`);
    seen.add(w.key);
    // 1. a widget with no component is a blank square in a grid
    if (!components.has(w.key)) errors.push(`widget "${w.key}" has no component in WIDGET_COMPONENTS — it would render nothing.`);
    // 2. its gate must name a real section
    if (w.section && !sections[w.section]) errors.push(`widget "${w.key}" gates on "${w.section}", which is not in SECTION_ACCESS.`);
    // 3. every defaultFor names a real role
    for (const r of w.defaultFor) if (!roles.has(r)) errors.push(`widget "${w.key}" has defaultFor "${r}", which is not a UserRole.`);
    // 4. every module names a real module
    if (w.module && !modules.has(w.module)) errors.push(`widget "${w.key}" needs module "${w.module}", which is not a ModuleKey.`);
    // 5. and it must render into a tab that exists
    if (w.tab && !tabs.has(w.tab)) errors.push(`widget "${w.key}" renders into tab "${w.tab}", which is not in DASHBOARD_TABS.`);
    if (w.span != null && w.span !== "workspace" && !(Number.isInteger(w.span) && w.span >= 1 && w.span <= 12))
      errors.push(`widget "${w.key}" has span "${w.span}" — only 1–12 columns or workspace lay out.`);
  }
  /**
   * 6. D-DR24: a `workspace` widget IS its tab, so it cannot share one.
   *
   * The failure it prevents is silent rather than loud. `TabWidgets` renders the workspace and
   * returns, so a card added to that tab would simply never appear — catalogued, gated, reachable in
   * the permissions preview, and invisible on the page. Nothing else in this file or the suite would
   * notice, because every other check asks whether a widget is WELL FORMED and not whether it is
   * drawn. The tab is also full-bleed by then, so there is nowhere for a card to go.
   */
  const workspaceTabs = new Set(list.filter((w) => w.span === "workspace").map((w) => w.tab));
  for (const tab of workspaceTabs) {
    const sharing = list.filter((w) => w.tab === tab && w.span !== "workspace");
    if (sharing.length > 0)
      errors.push(`tab "${tab}" holds a workspace widget and ${sharing.length} other widget(s) (${sharing.map((w) => w.key).join(", ")}) — a workspace IS its tab, so those would never render.`);
    if (list.filter((w) => w.tab === tab && w.span === "workspace").length > 1)
      errors.push(`tab "${tab}" holds more than one workspace widget — only one surface can fill a tab.`);
  }
  // ...and the other direction, which is how `navIcons.ts` drift is caught for surfaces.
  for (const key of components) if (!seen.has(key)) errors.push(`WIDGET_COMPONENTS has "${key}", which is not in DASHBOARD_WIDGETS — the split has drifted.`);
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
    // SP1's four: a directory with no door, both kinds of link, a default nobody could change, and
    // a default naming a role that does not exist.
    [[{ key: "a", path: "/real", kind: "staff", reachedFrom: "missing" }], new Set(), /a screen with no door/],
    [[{ key: "p", path: "/parent", kind: "staff" }, { key: "a", path: "/real", kind: "staff", parent: "p", reachedFrom: "p" }], new Set(["p"]), /not both/],
    [[{ key: "a", path: "/real", kind: "admin", startsOnFor: [] }], new Set(["a"]), /is a lock/],
    [[{ key: "a", path: "/real", kind: "section", section: "fuel", level: "view", startsOnFor: ["wizard"] }], new Set(["a"]), /not a UserRole/],
    // The directory's two: a screen behind a plain entry, and a directory with nothing behind it.
    [[{ key: "d", path: "/real", kind: "staff" }, { key: "a", path: "/real", kind: "staff", reachedFrom: "d" }], new Set(["d"]), /not a directory\(\) gate/],
    [[{ key: "d", path: "/real", kind: "directory" }], new Set(["d"]), /can never be shown/],
  ];
  const fails = [];
  for (const [cat, icons, expected] of cases) {
    const found = findViolations({ cat, icons, routes, sections, roles: new Set(["admin", "auditor"]) });
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
    // No waived path among the authenticated routes, so every waiver is stale. It used to keep the
    // first waiver live and expect the REST to fire, which stopped proving anything when SP1 left
    // exactly one.
    authRoutes: ["/real"],
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

  // ── D-DW4: the widget detectors, each proven to fire ──────────────────────────────────────────
  const wBase = { key: "t.w", tab: "fleet", section: "fuel", module: null, span: 6, defaultFor: [] };
  const wEnv = { tabs: new Set(["fleet"]), sections, roles: new Set(["admin"]), modules: new Set(["dispatch"]) };
  const wCases = [
    [[wBase], new Set(), /has no component/],
    [[{ ...wBase, section: "nowhere" }], new Set(["t.w"]), /not in SECTION_ACCESS/],
    [[{ ...wBase, defaultFor: ["wizard"] }], new Set(["t.w"]), /not a UserRole/],
    [[{ ...wBase, module: "teleport" }], new Set(["t.w"]), /not a ModuleKey/],
    [[{ ...wBase, tab: "nowhere" }], new Set(["t.w"]), /not in DASHBOARD_TABS/],
    [[{ ...wBase, span: "third" }], new Set(["t.w"]), /only 1–12 columns or workspace/],
    [[{ ...wBase, span: 13 }], new Set(["t.w"]), /only 1–12 columns or workspace/],
    // D-DR24: a workspace sharing its tab, and two workspaces on one tab. Both render nothing and
    // say nothing, which is exactly the class of defect this file exists for.
    [[{ ...wBase, key: "t.ws", span: "workspace" }, wBase], new Set(["t.w", "t.ws"]), /would never render/],
    [[{ ...wBase, key: "t.ws", span: "workspace" }, { ...wBase, key: "t.ws2", span: "workspace" }], new Set(["t.ws", "t.ws2"]), /more than one workspace/],
    [[wBase, wBase], new Set(["t.w"]), /declared twice/],
    [[wBase], new Set(["t.w", "t.ghost"]), /split has drifted/],
  ];
  for (const [list, components, expected] of wCases) {
    const found = findWidgetViolations({ list, components, ...wEnv });
    if (!found.some((e) => expected.test(e))) fails.push(`widget detector did not fire for ${expected}: got ${JSON.stringify(found)}`);
  }
  const wClean = findWidgetViolations({ list: [wBase], components: new Set(["t.w"]), ...wEnv });
  if (wClean.length) fails.push(`false positive on a clean widget catalogue: ${JSON.stringify(wClean)}`);

  // A clean catalogue must produce nothing — a gate that always fires is a gate nobody keeps. It
  // carries a directory screen with a starting default, so SP1's detectors are held to that too.
  const clean = findViolations({
    cat: [
      { key: "a", path: "/real", kind: "directory" },
      { key: "b", path: "/parent", kind: "section", section: "fuel", level: "view", reachedFrom: "a", startsOnFor: ["auditor"] },
    ],
    icons: new Set(["a"]), routes, sections, roles: new Set(["admin", "auditor"]),
  });
  if (clean.length) fails.push(`false positive on a clean catalogue: ${JSON.stringify(clean)}`);
  return fails;
}

if (process.argv.includes("--self-test")) {
  const fails = selfTest();
  if (fails.length) { for (const f of fails) console.error(`✗ self-test: ${f}`); process.exit(1); }
  console.log("✓ surfaces self-test — all twenty-six detectors fire, and none fires on a clean catalogue.");
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

const widgetList = widgets(readFileSync(WIDGETS, "utf8"));
const widgetComponents = widgetComponentKeys(readFileSync(WIDGET_COMPONENTS_FILE, "utf8"));
const tabs = tabKeys(readFileSync(TABS, "utf8"));
const roles = stringArray(readFileSync(CONSTANTS, "utf8"), "USER_ROLES");
const modules = stringArray(readFileSync(ENTITLEMENTS, "utf8"), "MODULE_KEYS");

const errors = [
  ...findViolations({ cat, icons, routes, sections, roles, authRoutes, apiGates }),
  ...findWidgetViolations({ list: widgetList, components: widgetComponents, tabs, sections, roles, modules }),
];
if (errors.length) {
  console.error(`✗ ${errors.length} surface-catalogue violation(s):`);
  for (const e of errors) console.error(`   ${e}`);
  process.exit(1);
}
console.log(
  `✓ surfaces ok — ${cat.length} surfaces (${cat.filter((s) => !s.parent && !s.reachedFrom).length} in the sidebar, ` +
    `${cat.filter((s) => s.reachedFrom).length} reached from a directory, ` +
    `${cat.filter((s) => s.parent).length} detail routes) all resolve to real routes; ` +
    `${icons.size} icons match the nav surfaces exactly; ` +
    `all ${authRoutes.length} authenticated routes are catalogued or waived; ` +
    `${apiGates.length} requireSurface gates name real screens; ` +
    `${widgetList.length} dashboard widgets across ${tabs.size} tabs all gate on real sections and have components.`,
);
