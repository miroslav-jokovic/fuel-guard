import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
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
// The export URL is the assertion — what it downloads is `download.ts`'s business, not this test's.
vi.mock("@/features/reports/download", () => ({ downloadReport: vi.fn(async () => undefined) }));
/*
 * ⚠ A zone that is NOT this machine's, deliberately. The claim under test is "the CARRIER's clock,
 * never the viewer's", and a CI box running America/Chicago makes those two indistinguishable — a
 * mutant that swapped `zone.value` for `Intl.DateTimeFormat().resolvedOptions().timeZone` survived
 * the first draft of these tests for exactly that reason. Denver is UTC-6 in September where
 * Chicago is UTC-5, so every expectation below is an hour away from what the viewer's clock gives.
 */
vi.mock("@/composables/useOrgTimezone", () => ({
  useOrgTimezone: () => ({ zone: { value: "America/Denver" }, isResolved: { value: true } }),
}));
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
import { downloadReport } from "@/features/reports/download";

/** `canView` built from an explicit allow-list, so a test states the GRANTS it is giving. */
const grants = (...allowed: AppSection[]) => (s: AppSection) => allowed.includes(s);

function mountShell() {
  return mount(DashboardPage, {
    global: {
      /*
       * ⚠ `VueQueryPlugin` since 2026-09-21 (D-PREC5/6, queue item 4). The stub note below used to
       * say the tabs were stubbed so vue-query never entered a test about which tab is chosen, and
       * that is still why they are stubbed — but the SHELL itself now reads the carrier's operating
       * timezone through `useOrgTimezone`, because its default window and its export URLs are both
       * statements about a day and a day is only a day on some clock. The plugin is here, and no
       * Supabase call is: the query never resolves in this test and the composable falls back to the
       * column's own default, which is exactly the behaviour a caller gets on first paint.
       */
      plugins: [VueQueryPlugin],
      stubs: {
        // Both tabs are stubbed: their contents have their own tests, and mounting the real fleet
        // tab would drag Supabase into a test about which tab is chosen.
        /**
         * ⚠ ONE stub since LM9, where there were two. `FleetOverviewTab` and `DispatchTab` are gone:
         * the shell now renders `TabWidgets` for whichever tab is active, and the catalogue decides
         * what goes inside it. The marker is built from the `tab` PROP, so every assertion below
         * still reads `fleet-tab` / `dispatch-tab` and still asserts the same thing — which tab's
         * content the shell chose to render.
         */
        TabWidgets: {
          props: ["tab", "range"],
          // `data-range` added 2026-09-21: the window the shell chose is only observable here.
          template: '<div :data-test="tab + \'-tab\'" :data-range="range ? range.from + \'\u2192\' + range.to : undefined" />',
        },
        DateRangeFilter: { template: '<div data-test="range-filter" />' },
        PageHeader: { template: "<div><slot /><slot name=\"actions\" /></div>" },
        Menu: { template: '<div data-test="export-menu"><slot /></div>' },
        MenuButton: true,
        MenuItems: { template: "<div><slot /></div>" },
        // Renders its slot so the export buttons exist to be clicked (the `active` slot prop is
        // headlessui's keyboard-focus flag and only drives a background class).
        MenuItem: { template: "<div><slot :active=\"false\" /></div>" },
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

/**
 * D-PREC5 and D-PREC6 at the shell, which is where both of them lived.
 *
 * Neither of these could fail before 2026-09-21 because nothing asked the page what window it had
 * chosen — 2,105 web tests passed while the default window ended TOMORROW for every reader west of
 * Greenwich after their evening, and while the exports covered a different set of fills than the
 * screen they were taken from.
 */
describe("the window the page asks about", () => {
  const AFTER_UTC_ROLLOVER = new Date("2026-09-21T02:00:00.000Z"); // 21:00 on the 20th, Central

  beforeEach(() => {
    sessionMock.canView = grants("fuel", "dispatch");
    vi.useFakeTimers();
    vi.setSystemTime(AFTER_UTC_ROLLOVER);
  });
  afterEach(() => vi.useRealTimers());

  /*
   * D-PREC6. `isoDay` was `d.toISOString().slice(0, 10)`, so at this instant the default window ran
   * to 2026-09-21 — tomorrow, on the carrier's clock. It is why the window that reproduced the
   * owner's 8.61 MPG was 08/22 – 09/21 rather than 08/21 – 09/20.
   */
  it("ends the default window today on the carrier's clock, not tomorrow on UTC's", () => {
    const w = mountShell();

    // Read off the RANGE THE TABS ARE GIVEN, not off the component instance. `<script setup>`
    // bindings are not on a component's public type, so `w.vm.range` is a `vue-tsc` error — it runs
    // fine under vitest, which does not typecheck, and only the typecheck says so. (It said so
    // locally too, at exit code 2; `pnpm -s typecheck` silences the child output, so the failure
    // looked like silence. Check the exit code, not the output.) Reading the rendered prop is the
    // better assertion anyway: it is what the page actually hands its tabs.
    const tab = w.find("[data-range]");
    expect(tab.attributes("data-range")).toBe("2026-08-21→2026-09-20");
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-09-21"); // what it used to answer
  });

  /*
   * D-PREC5. The exports filter `fuel_transactions.fueled_at`, a `timestamptz`, so they DO take an
   * instant interval — in the carrier's zone. Built at the BROWSER's midnight until this landed,
   * which under this test's UTC clock is a five-hour error in both bounds.
   */
  it("exports the same window it is showing, bounded on the carrier's clock", async () => {
    const w = mountShell();
    // Click the real menu item, so this asserts what a reader pressing "Transactions CSV" gets.
    const item = w.findAll("button").find((b) => b.text().includes("Transactions CSV"));
    expect(item, "the Transactions CSV export button").toBeTruthy();
    await item!.trigger("click");

    const url = vi.mocked(downloadReport).mock.calls.at(-1)?.[0] ?? "";
    const q = new URLSearchParams(url.slice(url.indexOf("?")));
    expect(q.get("from")).toBe("2026-08-21T06:00:00.000Z"); // MDT, UTC-6 — Chicago would be 05:00
    // The day AFTER `to`, exclusive — never a T23:59:59.999 that drops the last sliver of a second.
    expect(q.get("to")).toBe("2026-09-21T06:00:00.000Z");
  });
});
