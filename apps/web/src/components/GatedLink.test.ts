import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import GatedLink from "./GatedLink.vue";
import BreadcrumbTrail from "./ui/BreadcrumbTrail.vue";
import SidebarProfileMenu from "@/layouts/SidebarProfileMenu.vue";

/**
 * The two shapes SP5 gives a door whose page does not open (plan §4b): an inline link that becomes
 * plain text (`GatedLink`, a crumb) and a menu entry that is not offered (the account menu's
 * Settings). Each is asked through `useOpens`, which reads the session — the real shape here.
 */
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("admin");
  return { useSessionStore: () => s, __session: s };
});
const { __session: session } = (await import("@/stores/session")) as unknown as {
  __session: import("@/testing/fakeSession").FakeSession;
};

const RouterLink = { props: ["to"], template: `<a :href="String(to)"><slot /></a>` };
const global = { stubs: { RouterLink } };

beforeEach(() => {
  session.role = "admin";
  session.sections = null;
  session.surfaces = null;
});

describe("GatedLink", () => {
  it("is a link, with the link's class, where the page opens", () => {
    const w = mount(GatedLink, { props: { to: "/vehicles/v1" }, attrs: { class: "text-link" }, slots: { default: "T-118" }, global });
    expect(w.find("a").attributes("href")).toBe("/vehicles/v1");
    expect(w.find("a").classes()).toContain("text-link");
  });

  it("is plain text, without the link's colour, where a per-person answer shuts the page", () => {
    session.surfaces = { "fleet.vehicles": false };
    const w = mount(GatedLink, {
      props: { to: "/vehicles/v1", plainClass: "font-semibold text-ink" },
      attrs: { class: "text-link" },
      slots: { default: "T-118" },
      global,
    });
    expect(w.find("a").exists()).toBe(false);
    expect(w.text()).toBe("T-118");
    expect(w.find("span").classes()).toEqual(["font-semibold", "text-ink"]);
  });

  it("is plain text where the org's section claim closes the page", () => {
    session.role = "fleet_manager";
    session.sections = { equipment: "none" };
    expect(mount(GatedLink, { props: { to: "/vehicles/v1" }, slots: { default: "x" }, global }).find("a").exists()).toBe(false);
  });
});

describe("BreadcrumbTrail", () => {
  const trail = [
    { label: "Loads", to: "/loads" },
    { label: "Hazmat load", to: "/hazmat/loads/h1" },
  ];
  it("links every crumb when no answer is given, which is what the lab renders", () => {
    expect(mount(BreadcrumbTrail, { props: { trail }, global }).findAll("a")).toHaveLength(1);
  });
  it("renders a crumb the reader cannot open as text", () => {
    const w = mount(BreadcrumbTrail, { props: { trail, opens: (to: string) => to !== "/loads" }, global });
    expect(w.findAll("a")).toHaveLength(0);
    expect(w.text()).toContain("Loads");
  });
});

describe("the account menu's Settings link", () => {
  const menu = () =>
    mount(SidebarProfileMenu, {
      props: { email: "a@b.test", role: session.role },
      global: { stubs: { RouterLink, KebabMenu: { template: "<div><slot name='trigger' /><slot /></div>" } } },
    });
  it("is offered to the admin and not to a fleet manager with no Settings screen on", () => {
    expect(menu().find("a[href='/settings']").exists()).toBe(true);
    session.role = "fleet_manager";
    expect(menu().find("a[href='/settings']").exists()).toBe(false);
  });
  it("is offered to a fleet manager once one screen behind Settings is turned on for them", () => {
    session.role = "fleet_manager";
    session.surfaces = { "admin.settings.notifications": true };
    expect(menu().find("a[href='/settings']").exists()).toBe(true);
  });
});
