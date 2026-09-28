import { afterEach, describe, expect, it, vi } from "vitest";
import { RouterLinkStub, enableAutoUnmount, mount } from "@vue/test-utils";
import { callerCanManage, callerCanView, type SectionClaim } from "@silvicom/shared";
import SettingsPage from "@/pages/SettingsPage.vue";

/**
 * The Settings index's Recruiting card (Q-AW42). It asks `recruitment: view`, the question its route's
 * catalogue entry (`admin.recruiting`) asks — not `admin`, and not `settings`. Every role that can open
 * this page holds `recruitment` in the shipped matrix, so the cases that tell the gates apart are a
 * non-admin who holds it and an org that has taken it away (D-PERM2's overrides).
 */
const session = vi.hoisted(() => ({
  role: "admin" as string,
  admin: false,
  readOnly: false,
  can: (_s: string): boolean => false,
  canView: (_s: string): boolean => false,
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => session }));
const asRole = (role: string, sections: SectionClaim | null = null): void => {
  session.role = role;
  session.admin = role === "admin";
  session.readOnly = role === "auditor";
  session.can = (s) => callerCanManage(role as never, s as never, sections);
  session.canView = (s) => callerCanView(role as never, s as never, sections);
};

enableAutoUnmount(afterEach);

const cards = (role: string, sections: SectionClaim | null = null) => {
  asRole(role, sections);
  const w = mount(SettingsPage, {
    global: { stubs: { RouterLink: RouterLinkStub, PageHeader: true, FleetReadiness: true } },
  });
  return w.findAllComponents(RouterLinkStub).map((l) => l.props("to"));
};

describe("the Recruiting card", () => {
  it("shows for an auditor, who is not an admin and holds `recruitment: view`", () => {
    expect(cards("auditor")).toContain("/settings/recruiting");
  });

  it("does not show for a fleet manager whose org took the recruitment section away", () => {
    expect(cards("fleet_manager")).toContain("/settings/recruiting");
    expect(cards("fleet_manager", { recruitment: "none" })).not.toContain("/settings/recruiting");
  });
});
