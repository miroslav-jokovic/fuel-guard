import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The navigation guard's SECTION gates — `requiresManage` and the `requiresView` added 2026-09-02.
 *
 * Written because nothing drove the guard before. `routeTable.test.ts` pins which component a URL
 * resolves to, and `check-capabilities.mjs` pins that a meta names a real section, but neither one
 * ever asked the question a permission check exists to answer: *does this role get in?* That gap is
 * how `/settings` shipped gated at `manage` while its sidebar entry asked `view` — the two halves
 * disagreed for as long as both existed, and no test could tell.
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
});
