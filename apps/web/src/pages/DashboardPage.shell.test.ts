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
/**
 * ⚠ `useRouter` is mocked as well as `useRoute` since D-DR24: the page writes the open tab back into
 * `?tab=`, because the SHELL reads the tab from the URL to decide whether its outlet is a document or
 * a workspace. `replace` is recorded rather than stubbed away — "renders the dispatch tab after the
 * admin picks it" asserts that the URL followed the strip.
 */
const replaced: { query?: Record<string, unknown> }[] = [];
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ replace: (to: { query?: Record<string, unknown> }) => { replaced.push(to); } }),
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

    /**
     * ⚠ D-DR24: and the URL followed, which is not cosmetic. `AppShell` reads `?tab=` to decide
     * whether its outlet is a document or an edge-to-edge workspace, so a strip that changed the
     * tab without changing the URL would leave the live map in a padded document column.
     */
    expect(replaced.at(-1)?.query).toMatchObject({ tab: "dispatch" });
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

    /**
     * ⚠ D-DR24: and the URL followed, which is not cosmetic. `AppShell` reads `?tab=` to decide
     * whether its outlet is a document or an edge-to-edge workspace, so a strip that changed the
     * tab without changing the URL would leave the live map in a padded document column.
     */
    expect(replaced.at(-1)?.query).toMatchObject({ tab: "dispatch" });
  });

  /**
   * ⚠ **The strip has to survive the tab it selects.** Reported by the owner 2026-09-20: an admin who
   * opened Dispatch had no way back to Fleet overview.
   *
   * D-DR24 drops the hero and the page's vertical rhythm on a workspace tab, which is right — 200px
   * of scenery in front of a map that needs height. But the control row was inside the same
   * `v-if="!workspace"`, and the control row is where the tab strip lives. So picking Dispatch
   * unmounted the only control that could pick anything else, and the sole escape was editing `?tab=`
   * by hand. It is a trap rather than a missing feature: the act of selecting the tab destroyed the
   * means of deselecting it.
   *
   * The test above could not catch it because it asserts only which CONTENT rendered. This one
   * asserts the way back is still on screen, which is the thing a reader actually needs.
   */
  it("keeps the strip after picking the workspace tab, so there is a way back", async () => {
    sessionMock.role = "admin";
    sessionMock.canView = grants("fuel", "dispatch", "accounting");
    const w = mountShell();

    await w.findAll('[role="tab"]').find((t) => t.text().includes("Dispatch"))!.trigger("click");
    expect(w.find('[data-test="dispatch-tab"]').exists(), "the map should be open").toBe(true);

    const fleetTab = w.findAll('[role="tab"]').find((t) => t.text().includes("Fleet overview"));
    expect(fleetTab, "a Fleet overview tab must still be reachable from the map").toBeTruthy();

    // And it must actually work, not merely be painted: a strip that is present but inert would
    // satisfy the assertion above and strand the reader just as completely.
    await fleetTab!.trigger("click");
    expect(w.find('[data-test="fleet-tab"]').exists(), "clicking it should return to Fleet overview").toBe(true);
    expect(replaced.at(-1)?.query).toMatchObject({ tab: "fleet" });
  });

  /**
   * The teleport target is load-bearing markup: `TabWidgets` moves Customize into `#dashboard-actions`
   * BY ID, so an element that disappears on the workspace tab takes Customize with it — silently, in
   * a production build. It went the same way as the strip, inside the same `v-if`.
   */
  it("keeps the Customize teleport target on the workspace tab", async () => {
    sessionMock.role = "admin";
    sessionMock.canView = grants("fuel", "dispatch", "accounting");
    const w = mountShell();

    await w.findAll('[role="tab"]').find((t) => t.text().includes("Dispatch"))!.trigger("click");
    expect(w.find("#dashboard-actions").exists(), "TabWidgets teleports Customize here by id").toBe(true);
  });

  /**
   * The height budget, which nothing pinned until the control row stopped being dropped.
   *
   * A workspace tab is a flex column filling the height `AppShell` gave it, and the row above the map
   * now permanently spends ~36px of it. `min-h-0` is what lets the widgets SHRINK inside that column
   * — without it a canvas grows to its content and pushes the strip back off screen, which is the
   * same symptom by a different route. `flex-1` is what makes it take the rest.
   */
  it("lets the workspace tab's widgets shrink to whatever the row leaves them", async () => {
    sessionMock.role = "admin";
    sessionMock.canView = grants("fuel", "dispatch", "accounting");
    const w = mountShell();

    await w.findAll('[role="tab"]').find((t) => t.text().includes("Dispatch"))!.trigger("click");
    const widgets = w.find('[data-test="dispatch-tab"]');
    expect(widgets.classes()).toContain("min-h-0");
    expect(widgets.classes()).toContain("flex-1");
  });
});

/**
 * ── THE CONTROL ROW (D-DT20) ──────────────────────────────────────────────────────────────────
 * What this pins is a LAYOUT fact, which is unusual here and is the point: the range picker and
 * Export used to be `PageHeader`'s actions and Customize was a row `TabWidgets` drew for itself,
 * so the three controls that scope this page sat in three places — two of them on top of the hero
 * photograph. The row is also load-bearing markup: `TabWidgets` teleports Customize into
 * `#dashboard-actions` BY ID, so renaming or dropping the element puts the button back over the
 * truck silently, in a production build, with no warning.
 */
describe("the control row", () => {
  it("keeps the tab strip and the scope controls in one row", () => {
    sessionMock.canView = grants("fuel", "dispatch", "accounting");
    const w = mountShell();

    const tablist = w.find('[role="tablist"]');
    const actions = w.find("#dashboard-actions");
    expect(tablist.exists()).toBe(true);
    expect(actions.exists(), "TabWidgets teleports Customize into #dashboard-actions by id").toBe(true);
    // Siblings, not merely both-present: a row is what puts them on one line.
    expect(actions.element.parentElement).toBe(tablist.element.parentElement);
    // And the scope controls are inside it rather than back up in the header.
    expect(actions.find('[data-test="range-filter"]').exists()).toBe(true);
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
