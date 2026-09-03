import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The navigation guard's SECTION gates — `requiresManage` and the `requiresView` added 2026-09-02.
 *
 * Written because nothing drove the guard before. `routeTable.test.ts` pins which component a URL
 * resolves to, and `check-surfaces.mjs` pins that every authenticated route is catalogued, but
 * neither one ever asks the question a permission check exists to answer: *does this role get in?*
 * That gap is how `/settings` shipped gated at `manage` while its sidebar entry asked `view` — the
 * two halves disagreed for as long as both existed, and no test could tell.
 *
 * Since S2 the guard reads the SURFACE CATALOGUE rather than a per-route meta, so these assertions
 * are now also the test that the catalogue's gates are the ones the product enforces. The 28 routes
 * below had NO route gate at all before that change: their sidebar entry was hidden and the URL
 * still worked.
 *
 * ⚠ The mocked session is deliberately the REAL shape: `can` is manage-only and `canView` is
 * view-or-manage, exactly as `stores/session.ts` derives them from the shared matrix. A mock that
 * collapsed the two would pass whatever the guard did, which is the failure this file is about.
 */
const session = vi.hoisted(() => ({
  initialized: true,
  isAuthenticated: true,
  hasOrg: true,
  role: "auditor" as string | null,
  admin: false,
  readOnly: false,
  can: (_s: string): boolean => false,
  canView: (_s: string): boolean => false,
  surfaces: null as Record<string, boolean> | null,
  init: vi.fn(),
}));

vi.mock("@/stores/session", () => ({ useSessionStore: () => session }));

const { router } = await import("./index");

/** Put the session in one role's shoes, using the shared matrix rather than hand-set booleans. */
async function asRole(role: string) {
  const { sectionAccess, isAdmin, isReadOnly } = await import("@silvicom/shared");
  session.role = role;
  session.admin = isAdmin(role as never);
  session.readOnly = isReadOnly(role as never);
  session.can = (s: string) => sectionAccess(role as never, s as never) === "manage";
  session.canView = (s: string) => sectionAccess(role as never, s as never) !== "none";
}

/** Where does this role actually land when it asks for `path`? */
async function landsOn(role: string, path: string): Promise<string> {
  await asRole(role);
  await router.push("/").catch(() => {});
  await router.push(path).catch(() => {});
  await router.isReady();
  return String(router.currentRoute.value.name);
}

beforeEach(() => {
  session.initialized = true;
  session.isAuthenticated = true;
  session.hasOrg = true;
  session.surfaces = null;
});

describe("the section gates on the navigation guard", () => {
  // ── The defect this meta was added for (Q-SURF5) ────────────────────────────
  it("lets an auditor open /settings — the page their `settings: view` was granted for", async () => {
    expect(await landsOn("auditor", "/settings")).toBe("settings");
  });

  it("still lets an admin and a fleet manager open /settings", async () => {
    expect(await landsOn("admin", "/settings")).toBe("settings");
    expect(await landsOn("fleet_manager", "/settings")).toBe("settings");
  });

  it("still refuses /settings to a role holding none of it", async () => {
    // dispatcher, safety_manager, recruiter, accountant and technician are all `settings: "none"`.
    expect(await landsOn("dispatcher", "/settings")).toBe("dashboard");
    expect(await landsOn("technician", "/settings")).toBe("dashboard");
  });

  // ── `view` is not `manage`, at the guard as everywhere else ─────────────────
  it("does not let the auditor's view access open a MANAGE route in the same section", async () => {
    // `/settings/data` is `requiresManage: "settings"`, and stays that way — re-syncing Samsara is
    // not a read. If `requiresView` had been resolved through `session.can`, or this route through
    // `canView`, one of these two assertions would have to be wrong.
    expect(await landsOn("auditor", "/settings/data")).toBe("dashboard");
    expect(await landsOn("admin", "/settings/data")).toBe("data-sync");
  });

  it("keeps the fuel manage gates intact — the auditor reads fuel but may not import", async () => {
    // `auditor` holds `fuel: "view"`, so this is the same shape as /settings and must NOT follow it.
    expect(await landsOn("auditor", "/import")).toBe("dashboard");
    expect(await landsOn("fleet_manager", "/import")).toBe("import");
  });

  // ── The other gates the guard runs, unchanged by this addition ──────────────
  it("keeps requiresAdmin admin-only", async () => {
    expect(await landsOn("auditor", "/settings/users")).toBe("dashboard");
    expect(await landsOn("admin", "/settings/users")).toBe("users");
  });

  it("keeps the audit log open to the admin and the read-only reviewer", async () => {
    expect(await landsOn("auditor", "/settings/audit")).toBe("audit");
    expect(await landsOn("admin", "/settings/audit")).toBe("audit");
    expect(await landsOn("dispatcher", "/settings/audit")).toBe("dashboard");
  });

  it("still sends a driver to the driver app whatever they ask for", async () => {
    expect(await landsOn("driver", "/settings")).toBe("driver-app");
  });

  // ── S2: the 28 routes whose menu entry was hidden while the URL still worked ─────────────
  // One per section, at the level the catalogue states, in both directions. The `landsOn`
  // expectation is the ROUTE NAME, so "dashboard" means the guard turned them away.
  const CLOSED: Array<[string, string, string, string]> = [
    // path,                   section    a role that HOLDS it,  a role that does NOT
    // Was `/transactions` until FUEL-C2 turned that path into a redirect with no surface of its own;
    // Cards is the fuel section's other `view`-level screen and asks the guard the same question.
    ["/fuel-cards", "fuel", "auditor", "recruiter"],
    ["/ifta", "fuel", "accountant", "recruiter"],
    ["/loads", "dispatch", "dispatcher", "recruiter"],
    ["/truck-stops", "dispatch", "auditor", "recruiter"],
    ["/anomalies", "safety", "safety_manager", "technician"],
    ["/driver-performance", "safety", "auditor", "technician"],
    ["/drivers", "roster", "recruiter", "technician"],
    ["/compliance", "roster", "safety_manager", "accountant"],
    ["/vehicles", "equipment", "technician", "recruiter"],
    ["/trailers", "equipment", "dispatcher", "recruiter"],
    ["/recruitment", "recruitment", "recruiter", "dispatcher"],
    ["/recruitment/inquiries", "recruitment", "auditor", "technician"],
    ["/accounting", "accounting", "accountant", "dispatcher"],
    ["/billing", "billing", "accountant", "fleet_manager"],
    ["/shop", "maintenance", "technician", "dispatcher"],
    ["/shop/inspectors", "maintenance", "accountant", "recruiter"],
  ];
  for (const [path, sec, allowed, denied] of CLOSED) {
    it(`${path} (${sec}) admits ${allowed} and turns away ${denied}`, async () => {
      expect(await landsOn(allowed, path)).not.toBe("dashboard");
      expect(await landsOn(denied, path)).toBe("dashboard");
    });
  }

  // ── D-SURF8: a detail route inherits its list surface's grant ────────────────────────────
  it("a detail route is closed to a role its list surface is closed to", async () => {
    // `/drivers/:id` had no gate of its own. Denying Drivers must deny the bookmark too, which is
    // the whole reason a detail route is catalogued with a `parent` rather than left out.
    expect(await landsOn("recruiter", "/drivers/x")).not.toBe("dashboard");
    expect(await landsOn("technician", "/drivers/x")).toBe("dashboard");
    expect(await landsOn("accountant", "/shop/inspections/x")).not.toBe("dashboard");
    expect(await landsOn("recruiter", "/shop/inspections/x")).toBe("dashboard");
  });

  it("the reporting screens now ask what their settings card always asked", async () => {
    // `/reports` and its three siblings had no route gate. Their card on the settings page shows on
    // `can("settings") || readOnly`, which resolves to exactly rolesThatCanView("settings").
    for (const p of ["/reports", "/coverage", "/reefer-coverage", "/recall-audit"]) {
      expect(await landsOn("auditor", p)).not.toBe("dashboard");
      expect(await landsOn("dispatcher", p)).toBe("dashboard");
    }
  });

  // ── S3: the org's own answers about which screens a role may reach ───────────────────────
  // The owner's worked example, end to end at the router: "Technician shop should see only annual
  // inspection page and nothing else."
  it("an org that denies two maintenance screens to technicians is obeyed by the router", async () => {
    session.surfaces = { "maintenance.repair-spend": false, "maintenance.inspectors": false };
    expect(await landsOn("technician", "/shop")).toBe("dashboard");
    expect(await landsOn("technician", "/shop/inspectors")).toBe("dashboard");
    // …and the one screen they were left keeps working, which is the whole point of the exercise.
    expect(await landsOn("technician", "/shop/inspections")).not.toBe("dashboard");
  });

  it("…and the denial is per ROLE, not per org — a fleet manager still reaches them", async () => {
    session.surfaces = null; // a fleet_manager's own claim carries no denials
    expect(await landsOn("fleet_manager", "/shop/inspectors")).not.toBe("dashboard");
  });

  it("a denial reaches the detail route through its parent (D-SURF8)", async () => {
    // `/shop/inspections/:id` has no key of its own. Denying Annual Inspections must close the
    // bookmark too, or the deny is a menu tidy rather than a permission.
    session.surfaces = { "maintenance.inspections": false };
    expect(await landsOn("technician", "/shop/inspections")).toBe("dashboard");
    expect(await landsOn("technician", "/shop/inspections/abc")).toBe("dashboard");
  });

  it("a surface answer can only NARROW — it never lifts a role past its section (D-SURF2)", async () => {
    // A recruiter holds `maintenance: none`. An org saying "allowed" about a maintenance screen
    // must not become a way to hand them the section, which is why the gate is checked first.
    session.surfaces = { "maintenance.inspectors": true, "maintenance.repair-spend": true };
    expect(await landsOn("recruiter", "/shop/inspectors")).toBe("dashboard");
    expect(await landsOn("recruiter", "/shop")).toBe("dashboard");
  });

  it("an empty answer denies nothing — the fail-open the store documents", async () => {
    session.surfaces = {};
    expect(await landsOn("technician", "/shop/inspectors")).not.toBe("dashboard");
  });

  it("an uncatalogued authenticated route still resolves — the gate, not the guard, is the net", async () => {
    // The guard falls through to `true` for a route with no surface, on purpose: failing closed
    // would turn every waiver in check-surfaces.mjs into a locked-out page. `/settings/audit` is
    // waived there (admin OR readOnly is not a section) and keeps its own meta.
    expect(await landsOn("auditor", "/settings/audit")).toBe("audit");
  });
});
