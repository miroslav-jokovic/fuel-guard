import { afterEach, describe, expect, it, vi } from "vitest";
import { RouterLinkStub, enableAutoUnmount, mount } from "@vue/test-utils";
import {
  SURFACES,
  USER_ROLES,
  callerCanManage,
  directoryScreens,
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

/** Every Settings screen turned on — what an admin who answered "yes" to all of them would store. */
const ALL_ON: SurfaceClaim = Object.fromEntries(directoryScreens("admin.settings").map((s) => [s.key, true]));
const PATHS = SETTINGS_CARDS.map((c) => SURFACES.find((s) => s.key === c.key)!.path);

/**
 * Owner, 2026-09-30: *"make all admin only by default"*. So the day-one answer is the whole list for
 * the admin, in the directory's order, and nothing for anyone else — and "nothing" has to be the
 * catalogue's answer rather than an empty page, which is why the router test pins that /settings
 * itself is closed to them too.
 */
describe("the directory's cards come from the catalogue", () => {
  it("shows the admin every card, in the directory's order", () => {
    expect(cards("admin")).toEqual(PATHS);
    expect(PATHS).toHaveLength(18);
  });

  for (const r of USER_ROLES.filter((x) => x !== "driver" && x !== "admin")) {
    it(`shows ${r} no card until the admin turns one on`, () => {
      expect(cards(r)).toEqual([]);
    });
  }

  it("shows a card the admin turned on for a role that starts without it (Q-SET2)", () => {
    expect(cards("fleet_manager", null, { "admin.settings.org": true })).toEqual(["/settings/org"]);
  });

  it("never shows the four Q-SET1 screens, or the FleetPal connection, to anyone but the admin, whatever is stored", () => {
    const shown = cards("fleet_manager", null, ALL_ON);
    for (const p of ["/settings/users", "/settings/permissions", "/settings/efs-soap", "/settings/card-control", "/settings/fleetpal"])
      expect(shown, p).not.toContain(p);
  });

  it("has a card for every screen the catalogue reaches from Settings, and no card for a screen that does not exist", () => {
    const carded = new Set(SETTINGS_CARDS.map((c) => c.key));
    for (const s of directoryScreens("admin.settings")) expect(carded.has(s.key), s.key).toBe(true);
    for (const c of SETTINGS_CARDS) expect(SURFACES.some((s) => s.key === c.key), c.key).toBe(true);
  });
});

/**
 * The Recruiting card (Q-AW42). Turned on, it asks `recruitment: view`, the question its route's
 * catalogue entry (`admin.recruiting`) asks — not `admin`, and not `settings`. The case that tells the
 * gates apart is an org that has taken the section away (D-PERM2's overrides).
 */
describe("the Recruiting card", () => {
  it("shows for an auditor it is turned on for, who is not an admin and holds `recruitment: view`", () => {
    expect(cards("auditor", null, ALL_ON)).toContain("/settings/recruiting");
  });

  it("does not show for a fleet manager whose org took the recruitment section away", () => {
    expect(cards("fleet_manager", null, ALL_ON)).toContain("/settings/recruiting");
    expect(cards("fleet_manager", { recruitment: "none" }, ALL_ON)).not.toContain("/settings/recruiting");
  });
});
