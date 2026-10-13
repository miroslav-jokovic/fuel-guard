import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";

/**
 * D-US4 — the per-collection table is drawn by `DataTable`, not a hand-styled `AppTable`.
 * `DataTable` swaps to cards below 768px and jsdom has no `matchMedia`, so the desktop breakpoint
 * is stubbed to reach the `<tbody>`.
 */
vi.mock("@vueuse/core", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useMediaQuery: () => ref(true) };
});
/** D-US5: flipped by the one test that asks what a connection that will not load looks like. */
const fetch = vi.hoisted(() => ({ failed: false, refetch: vi.fn() }));
vi.mock("@/features/settings/useFleetpalConnection", () => ({
  useFleetpalStatus: () => ({
    isLoading: ref(false),
    isFetching: ref(false),
    error: ref(fetch.failed ? new Error("502") : null),
    refetch: fetch.refetch,
    data: ref(fetch.failed ? undefined : {
      hasKey: true, enabled: true, schedulerOn: true, syncHours: 1, lastSyncedAt: null, lastError: null,
      resources: [{ resource: "work_orders", lastRunAt: null, lastError: "HTTP 500 from FleetPal", rowsSeen: 12345 }],
    }),
  }),
  useSaveFleetpalKey: () => ({ isPending: ref(false), mutateAsync: vi.fn() }),
  useSetFleetpalEnabled: () => ({ isPending: ref(false), mutateAsync: vi.fn() }),
}));
vi.mock("@/composables/useStepUpRetry", () => ({
  useStepUpRetry: () => ({ stepUpFor: ref(null), holdForStepUp: vi.fn(), confirmed: vi.fn(), cancel: vi.fn() }),
}));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));

import FleetpalSettingsPage from "./FleetpalSettingsPage.vue";
import DataTable from "@/components/ui/DataTable.vue";

describe("FleetPal collections table", () => {
  it("renders through DataTable with its three columns and a collection's row", () => {
    const w = mount(FleetpalSettingsPage, {
      global: { stubs: { PageHeader: true, JobActionCard: true, StepUpPrompt: true } },
    });
    const table = w.findComponent(DataTable);
    expect(table.exists()).toBe(true);
    expect(table.findAll("th").map((th) => th.text())).toEqual(["Collection", "Rows read", "Last run"]);
    const cells = table.findAll("tbody tr")[0]!.findAll("td").map((td) => td.text());
    expect(cells[0]).toContain("work_orders");
    expect(cells[0]).toContain("HTTP 500 from FleetPal");
    expect(cells[1]).toBe((12345).toLocaleString());
    expect(cells[2]).toBe("never");
  });
});

describe("a FleetPal connection that will not load", () => {
  it("says so and retries the read in place rather than asking for a page reload", async () => {
    fetch.failed = true;
    const w = mount(FleetpalSettingsPage, {
      global: { stubs: { PageHeader: true, JobActionCard: true, StepUpPrompt: true } },
    });
    expect(w.text()).toContain("Could not load the FleetPal connection.");
    expect(w.text()).not.toContain("Reload the page");
    await w.findAll("button").find((b) => b.text() === "Retry")!.trigger("click");
    expect(fetch.refetch).toHaveBeenCalledTimes(1);
    fetch.failed = false;
  });
});
