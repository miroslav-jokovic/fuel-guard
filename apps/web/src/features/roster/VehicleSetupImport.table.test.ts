import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";

/**
 * D-US4 — the CSV field reference and both preview tables are drawn by `DataTable`. The desktop
 * breakpoint is stubbed because jsdom has no `matchMedia` and DataTable would render cards.
 */
vi.mock("@vueuse/core", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useMediaQuery: () => ref(true) };
});
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("./useVehicleSetupImport", () => ({
  buildVehicleImportTemplate: () => "",
  buildSetupCsv: () => "",
  useCommitVehicleImport: () => ({ isPending: ref(false), mutateAsync: vi.fn() }),
  analyzeVehicleImportFile: vi.fn(async () => ({
    filename: "fleet.csv",
    totalRows: 2,
    unchanged: 0,
    errors: [],
    toCreate: [{
      unit_number: "T-101", fuel_type: "diesel", make: "Freightliner", model: "Cascadia", year: 2021,
      plate: null, vin: null, tank_capacity_gal: 120, baseline_mpg: null, current_odometer: 45000,
      status: "active", apu_type: null, has_optimized_idle: null, has_apu: null,
    }],
    toUpdate: [{
      id: "v9", unit_number: "T-9", tank_before: 100, tank_after: 150, mpg_before: 6.5, mpg_after: 6.5, equip_changed: false,
    }],
  })),
}));

import VehicleSetupImport from "./VehicleSetupImport.vue";
import DataTable from "@/components/ui/DataTable.vue";
import FileDropzone from "@/components/ui/FileDropzone.vue";

const headers = (t: ReturnType<ReturnType<typeof mount>["findComponent"]>) => t.findAll("th").map((th) => th.text());
const firstRow = (t: ReturnType<ReturnType<typeof mount>["findComponent"]>) =>
  t.findAll("tbody tr")[0]!.findAll("td").map((td) => td.text());

describe("vehicle import tables", () => {
  it("renders the CSV field reference through DataTable", () => {
    const w = mount(VehicleSetupImport, { props: { vehicles: [] } });
    const table = w.findComponent(DataTable);
    expect(headers(table)).toEqual(["Column", "Required", "Notes"]);
    expect(firstRow(table)).toEqual(["unit_number", "Yes", "Unique truck ID (e.g. T-101). Used to match existing vehicles."]);
    expect(table.findAll("tbody tr")).toHaveLength(13);
  });

  it("renders both previews through DataTable, blanks as the table's dash", async () => {
    const w = mount(VehicleSetupImport, { props: { vehicles: [] } });
    w.findComponent(FileDropzone).vm.$emit("files", [new File(["x"], "fleet.csv")]);
    await flushPromises();
    const [created, updated] = w.findAllComponents(DataTable);
    expect(headers(created!)).toEqual([
      "Unit", "Fuel type", "Make / Model / Year", "Plate / VIN", "Tank (gal)", "MPG", "Odometer", "Status", "Idle equipment",
    ]);
    expect(firstRow(created!)).toEqual([
      "T-101", "diesel", "Freightliner Cascadia 2021", "—", "120", "—", (45000).toLocaleString(), "active", "—",
    ]);
    expect(headers(updated!)).toEqual(["Unit", "Tank (gal)", "Baseline MPG", "Idle equipment"]);
    expect(firstRow(updated!)).toEqual(["T-9", "100 → 150", "6.5", "—"]);
  });
});
