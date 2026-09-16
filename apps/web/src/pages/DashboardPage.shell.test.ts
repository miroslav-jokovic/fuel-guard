import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import type { AppSection, UserRole } from "@silvicom/shared";

/**
 * The Dashboard SHELL — LM-T / D-DW6.
 *
 * ⚠ This file exists because `DashboardPage.test.ts` does not test the Dashboard. It mounts
 * `StatusBadge`, has done since it was written, and stayed green through the 488-line page being
 * split into three components — so the suite's pass count said nothing at all about the screen. A
 * green number that cannot go red is worse than no test, because it is read as coverage.
 *
 * What is pinned here is the SHELL's contract and not the tabs' contents: which tab component is
 * rendered, whether the strip appears, and — the one that matters — that the answer follows a
 * SECTION GRANT rather than a role name. `dashboardTabs.test.ts` proves the same rule at the pure
 * layer; this proves the component actually asks it.
 *
 * The session store is mocked rather than seeded, deliberately: the real `canView` is already
 * exercised against the real matrix in `dashboardTabs.test.ts`, and driving it from claims here
 * would test pinia's plumbing instead of this component's decision.
 */

/** Mutable between tests — each one installs the answers it wants before mounting. */
const sessionMock = {
  role: "admin" as UserRole | null,
  canView: (_s: AppSection) => true,
  can: (_s: AppSection) => true,
  readOnly: false,
};

vi.mock("@/stores/session", () => ({ useSessionStore: () => sessionMock }));
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRoute: () => ({ query: {} }),
}));

import DashboardPage from "@/pages/DashboardPage.vue";

/** `canView` built from an explicit allow-list, so a test states the GRANTS it is giving. */
const grants = (...allowed: AppSection[]) => (s: AppSection) => allowed.includes(s);

function mountShell() {
  return mount(DashboardPage, {
    global: {
      stubs: {
        // Both tabs are stubbed: their contents have their own tests, and mounting the real fleet
        // tab would drag vue-query and Supabase into a test about which tab is chosen.
        /**
         * ⚠ ONE stub since LM9, where there were two. `FleetOverviewTab` and `DispatchTab` are gone:
         * the shell now renders `TabWidgets` for whichever tab is active, and the catalogue decides
         * what goes inside it. The marker is built from the `tab` PROP, so every assertion below
         * still reads `fleet-tab` / `dispatch-tab` and still asserts the same thing — which tab's
         * content the shell chose to render.
         */
        TabWidgets: { props: ["tab"], template: '<div :data-test="tab + \'-tab\'" />' },
        DateRangeFilter: { template: '<div data-test="range-filter" />' },
        PageHeader: { template: "<div><slot /><slot name=\"actions\" /></div>" },
        Menu: { template: '<div data-test="export-menu"><slot /></div>' },
        MenuButton: true,
        MenuItems: true,
        MenuItem: true,
        RouterLink: true,
      },
    },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  sessionMock.role = "admin";
  sessionMock.canView = () => true;
  sessionMock.can = () => true;
  sessionMock.readOnly = false;
});

describe("which dashboard a caller gets", () => {
  it("gives an admin both tabs and opens the fleet overview", () => {
    sessionMock.role = "admin";
    sessionMock.canView = grants("fuel", "dispatch", "accounting");
    const w = mountShell();
    expect(w.findAll('[role="tab"]')).toHaveLength(2);
    expect(w.find('[data-test="fleet-tab"]').exists()).toBe(true);
    expect(w.find('[data-test="dispatch-tab"]').exists()).toBe(false);
  });

  it("opens a dispatcher on the DISPATCH tab, not on the first one in the catalogue", () => {
    // The defaultFor rule. Without it a dispatcher would land on Fleet overview, which is the tab
    // they care least about — and the whole reason this split was asked for.
    sessionMock.role = "dispatcher";
    sessionMock.canView = grants("fuel", "dispatch");
    const w = mountShell();
    expect(w.find('[data-test="dispatch-tab"]').exists()).toBe(true);
    expect(w.find('[data-test="fleet-tab"]').exists()).toBe(false);
  });

  it("shows no tab chrome when the caller may see one dashboard", () => {
    sessionMock.role = "safety_manager";
    sessionMock.canView = grants("fuel");
    const w = mountShell();
    expect(w.findAll('[role="tab"]')).toHaveLength(0);
    expect(w.find('[data-test="fleet-tab"]').exists()).toBe(true);
  });

  it("gives a caller with no sections an empty state and NOT the fleet dashboard (Q-LM-T1)", () => {
    // The regression this guards: a driver holds every section at `none` and previously landed on
    // the fleet's financial dashboard, because the surface is gated ALWAYS.
    sessionMock.role = "driver";
    sessionMock.canView = grants();
    const w = mountShell();
    expect(w.find('[data-test="fleet-tab"]').exists()).toBe(false);
    expect(w.find('[data-test="dispatch-tab"]').exists()).toBe(false);
    expect(w.text()).toContain("Nothing to show here yet");
  });

  it("follows the GRANT and not the role — the property a session.role branch cannot satisfy", () => {
    // Same role string in both mounts. Only the dispatch grant moves, as an org override would move
    // it. A component that tested `role === 'dispatcher'` would render identically twice and fail
    // exactly here.
    sessionMock.role = "safety_manager";
    sessionMock.canView = grants("fuel");
    expect(mountShell().findAll('[role="tab"]')).toHaveLength(0);

    sessionMock.canView = grants("fuel", "dispatch");
    const granted = mountShell();
    expect(granted.findAll('[role="tab"]')).toHaveLength(2);
    expect(granted.text()).toContain("Dispatch");
  });
});

describe("the tab strip actually switches the dashboard", () => {
  it("renders the dispatch tab after the admin picks it", async () => {
    sessionMock.role = "admin";
    sessionMock.canView = grants("fuel", "dispatch", "accounting");
    const w = mountShell();
    expect(w.find('[data-test="fleet-tab"]').exists()).toBe(true);

    const dispatchTab = w.findAll('[role="tab"]').find((t) => t.text().includes("Dispatch"));
    expect(dispatchTab, "a Dispatch tab should be in the strip").toBeTruthy();
    await dispatchTab!.trigger("click");

    expect(w.find('[data-test="dispatch-tab"]').exists()).toBe(true);
    expect(w.find('[data-test="fleet-tab"]').exists()).toBe(false);
  });
});

describe("the header's fleet-only controls", () => {
  it("offers the range filter and exports on the fleet tab", () => {
    sessionMock.role = "admin";
    sessionMock.canView = grants("fuel", "dispatch", "accounting");
    const w = mountShell();
    expect(w.find('[data-test="range-filter"]').exists()).toBe(true);
  });

  it("hides them on the dispatch tab, which has no range and nothing to export", () => {
    sessionMock.role = "dispatcher";
    sessionMock.canView = grants("fuel", "dispatch");
    const w = mountShell();
    expect(w.find('[data-test="dispatch-tab"]').exists()).toBe(true);
    expect(w.find('[data-test="range-filter"]').exists()).toBe(false);
  });
});
