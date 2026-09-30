import { afterEach, describe, expect, it, vi } from "vitest";
import { RouterLinkStub, enableAutoUnmount, mount } from "@vue/test-utils";
import {
  SURFACES,
  USER_ROLES,
  callerCanManage,
  callerCanView,
  directoryScreens,
  isReadOnly,
  type SectionClaim,
  type SurfaceClaim,
  type UserRole,
} from "@silvicom/shared";
import SettingsPage from "@/pages/SettingsPage.vue";
import { SETTINGS_CARDS } from "@/lib/settingsCards";

/**
 * The Settings directory (SETTINGS-PERMISSIONS-PLAN.md SP1). Its cards are read from the surface
 * catalogue since SP1, where each used to carry its own `show:` expression. The session is the real
 * shape the page reads — a role, the section claim and the screen claim — built from the shared
 * matrix, never a hand-written boolean.
 */
const session = vi.hoisted(() => ({
  role: "admin" as string,
  sections: null as SectionClaim | null,
  surfaces: null as SurfaceClaim | null,
  can: (_s: string): boolean => false,
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => session }));

enableAutoUnmount(afterEach);

const cards = (role: UserRole, sections: SectionClaim | null = null, surfaces: SurfaceClaim | null = null) => {
  session.role = role;
  session.sections = sections;
  session.surfaces = surfaces;
  session.can = (s) => callerCanManage(role, s as never, sections);
  const w = mount(SettingsPage, {
    global: { stubs: { RouterLink: RouterLinkStub, PageHeader: true, FleetReadiness: true } },
  });
  return w.findAllComponents(RouterLinkStub).map((l) => l.props("to") as string);
};

/**
 * Each card's `show:` expression as it was on `main` before SP1, keyed by path — the oracle for the
 * equivalence below, and written here only. `session.admin` was `role === "admin"` and
 * `session.readOnly` was `isReadOnly(role)`.
 */
const BEFORE: Record<string, (r: UserRole) => boolean> = {
  "/settings/org": (r) => r === "admin",
  "/settings/notifications": (r) => r === "admin",
  "/settings/users": (r) => r === "admin",
  "/settings/permissions": (r) => r === "admin",
  "/settings/driver-app": (r) => callerCanManage(r, "roster", null),
  "/settings/recruiting": (r) => callerCanView(r, "recruitment", null),
  "/settings/data": (r) => callerCanManage(r, "settings", null),
  "/settings/efs-soap": (r) => r === "admin",
  "/settings/card-control": (r) => r === "admin",
  "/settings/thresholds": (r) => r === "admin",
  "/settings/driver-performance": (r) => r === "admin",
  "/settings/fuel-planning": (r) => r === "admin",
  "/settings/audit": (r) => r === "admin" || isReadOnly(r),
  "/reports": (r) => callerCanManage(r, "settings", null) || isReadOnly(r),
  "/coverage": (r) => callerCanManage(r, "settings", null) || isReadOnly(r),
  "/reefer-coverage": (r) => callerCanManage(r, "settings", null) || isReadOnly(r),
  "/recall-audit": (r) => callerCanManage(r, "settings", null) || isReadOnly(r),
};

describe("the directory's cards come from the catalogue (SP1)", () => {
  for (const r of USER_ROLES.filter((x) => x !== "driver")) {
    it(`shows ${r} exactly the cards it saw before, in the same order`, () => {
      const expected = Object.entries(BEFORE)
        .filter(([, show]) => show(r))
        .map(([path]) => path);
      expect(cards(r)).toEqual(expected);
    });
  }

  it("shows a card the admin turned on for a role that starts without it (Q-SET2)", () => {
    expect(cards("fleet_manager")).not.toContain("/settings/org");
    expect(cards("fleet_manager", null, { "admin.settings.org": true })).toContain("/settings/org");
  });

  it("hides a card the admin turned off, which no hand-written expression could see", () => {
    expect(cards("auditor", null, { "admin.settings.audit": false })).not.toContain("/settings/audit");
    expect(cards("fleet_manager", null, { "admin.settings.data": false })).not.toContain("/settings/data");
  });

  it("has a card for every screen the catalogue reaches from Settings, and no card for a screen that does not exist", () => {
    const carded = new Set(SETTINGS_CARDS.map((c) => c.key));
    for (const s of directoryScreens("admin.settings")) expect(carded.has(s.key), s.key).toBe(true);
    for (const c of SETTINGS_CARDS) expect(SURFACES.some((s) => s.key === c.key), c.key).toBe(true);
  });
});

/**
 * The Recruiting card (Q-AW42). It asks `recruitment: view`, the question its route's catalogue entry
 * (`admin.recruiting`) asks — not `admin`, and not `settings`. The case that tells the gates apart is
 * an org that has taken the section away (D-PERM2's overrides).
 */
describe("the Recruiting card", () => {
  it("shows for an auditor, who is not an admin and holds `recruitment: view`", () => {
    expect(cards("auditor")).toContain("/settings/recruiting");
  });

  it("does not show for a fleet manager whose org took the recruitment section away", () => {
    expect(cards("fleet_manager")).toContain("/settings/recruiting");
    expect(cards("fleet_manager", { recruitment: "none" })).not.toContain("/settings/recruiting");
  });
});
