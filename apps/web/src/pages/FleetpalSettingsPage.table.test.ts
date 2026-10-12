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
vi.mock("@/features/settings/useFleetpalConnection", () => ({
  useFleetpalStatus: () => ({
    isLoading: ref(false),
    data: ref({
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
