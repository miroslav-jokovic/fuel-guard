import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { ref } from "vue";

/**
 * D-US4 — the bulk-entry grid is drawn by `DataTable`, its cells holding the inputs. The desktop
 * breakpoint is stubbed because jsdom has no `matchMedia` and DataTable would render cards.
 */
vi.mock("@vueuse/core", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useMediaQuery: () => ref(true) };
});
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));

import QualificationSeedPanel from "./QualificationSeedPanel.vue";
import DataTable from "@/components/ui/DataTable.vue";

const mountWith = (drivers: Array<{ id: string; full_name: string; state: string }>) =>
  mount(QualificationSeedPanel, {
    props: { drivers, orgSeeded: true },
    global: { plugins: [VueQueryPlugin] },
  });

describe("qualification seeding grid", () => {
  it("renders through DataTable with the five columns and one row per unqualified driver", () => {
    const w = mountWith([
      { id: "d1", full_name: "Ann Lee", state: "in_progress" },
      { id: "d2", full_name: "Bo Ray", state: "qualified" },
    ]);
    const table = w.findComponent(DataTable);
    expect(table.exists()).toBe(true);
    expect(table.findAll("th").map((th) => th.text())).toEqual([
      "Driver", "CDL expires", "Medical expires", "Endorsements", "Hazmat training completed",
    ]);
    const rows = table.findAll("tbody tr");
    expect(rows).toHaveLength(1);
    const cells = rows[0]!.findAll("td");
    expect(cells[0]!.text()).toBe("Ann Lee");
    expect(cells[1]!.find('[aria-label="CDL expiry for Ann Lee"]').exists()).toBe(true);
    expect(cells[3]!.text()).toContain("H");
  });

  it("keeps its empty sentence when every driver is already under way", () => {
    const w = mountWith([{ id: "d2", full_name: "Bo Ray", state: "qualified" }]);
    expect(w.findComponent(DataTable).text()).toContain("Every driver already has a qualification file under way.");
  });
});
