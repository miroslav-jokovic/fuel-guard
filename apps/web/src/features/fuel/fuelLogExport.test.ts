import { describe, it, expect } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia } from "pinia";
import { ref, type Component } from "vue";
import { fuelLogExportTarget } from "./fuelLogExport";
import ExportButton from "@/components/ExportButton.vue";
import type { FuelLogSharedFilters } from "./useFuelLogFilters";

/**
 * FUEL-P2 — the file a Fuel Log tab produces, and whether it covers what the screen covers.
 *
 * ── THE FAILURE THIS SUITE EXISTS FOR ───────────────────────────────────────────────────────────
 * A filter that is on screen and NOT in the export URL makes the file WIDER than the list above it,
 * and there is no symptom: the download works, the rows look right, and a controller quoting it in a
 * dispute is quoting a set nobody chose. Three tabs assembling a query string inline would be three
 * chances for one facet to be left out, which is why the assembly is one pure function and why every
 * tab's facet list is asserted below rather than reviewed.
 */

describe("the export URL is the page's own parameters, unrewritten", () => {
  it("carries the window and the truck list under the names the address bar uses", () => {
    const t = fuelLogExportTarget({ dataset: "fills", from: "2026-08-01", to: "2026-08-31", units: ["654", "655"] });
    expect(t.href).toBe("/api/fueling/exports/fills.csv?from=2026-08-01&to=2026-08-31&unit=654%2C655");
  });

  it("carries the open tab's own facets too", () => {
    const t = fuelLogExportTarget({
      dataset: "declines",
      units: [],
      facets: { risk: "alert", error: "51", policy: "P1", search: "pilot" },
    });
    expect(t.href).toBe("/api/fueling/exports/declines.csv?risk=alert&error=51&policy=P1&search=pilot");
  });

  // An empty facet is a filter nobody set. Sending `?item=` would make the server decide what a blank
  // means, and a parameter whose absence and whose emptiness mean the same thing should only have one
  // spelling.
  it("omits a facet nobody set rather than sending it empty", () => {
    const t = fuelLogExportTarget({ dataset: "source", units: [], facets: { item: "", state: undefined, driver: "A" } });
    expect(t.href).toBe("/api/fueling/exports/source-records.csv?driver=A");
  });

  it("asks for no parameters at all when nothing is filtered", () => {
    expect(fuelLogExportTarget({ dataset: "fills", units: [] }).href).toBe("/api/fueling/exports/fills.csv");
  });

  it("names the file after the list and the window, because six of these end up in one folder", () => {
    expect(fuelLogExportTarget({ dataset: "source", from: "2026-08-01", to: "2026-08-31", units: [] }).filename)
      .toBe("fuel-log-source-records-2026-08-01-to-2026-08-31.csv");
    expect(fuelLogExportTarget({ dataset: "fills", units: [] }).filename).toBe("fuel-log-fills-all-to-all.csv");
  });

  it("says what the file will cover, in the sentence the server prints on it", () => {
    expect(fuelLogExportTarget({ dataset: "fills", from: "2026-08-01", to: "2026-08-31", units: ["654"] }).scope)
      .toBe("2026-08-01 → 2026-08-31 · 1 truck");
    expect(fuelLogExportTarget({ dataset: "fills", units: [] }).scope).toBe("all dates · all trucks");
    expect(fuelLogExportTarget({ dataset: "fills", from: "2026-08-01", units: ["654", "655"] }).scope)
      .toBe("from 2026-08-01 · 2 trucks");
  });
});

/* ── The tabs, mounted ──────────────────────────────────────────────────────────────────────────── */

vi.mock("./useEfsData", () => ({
  EFS_PAGE_SIZE: 20,
  useEfsTransactions: () => listOf(),
  useDeclinedTransactions: () => listOf(),
  useEfsFacets: () => ({ data: ref(undefined) }),
  useEfsRowCoverage: () => ({ data: ref(null) }),
}));
vi.mock("./useFuelLog", () => ({
  FUEL_PAGE_SIZE: 20,
  useFuelTransactions: () => listOf(),
  useFuelRangeTotals: () => ({ data: ref(null) }),
}));
vi.mock("@/composables/useVehicles", () => ({ useVehiclesQuery: () => ({ data: ref([]) }) }));
vi.mock("@/composables/useDrivers", () => ({ useDriversQuery: () => ({ data: ref([]) }) }));
vi.mock("@/composables/useCardAssignments", () => ({
  useCardAssignments: () => ({ data: ref([]) }),
  useSyncCardAssignments: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }),
}));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(async () => ({ ok: true, data: null })), apiDownload: vi.fn() }));

import { vi } from "vitest";
import SourceRecordsTab from "./SourceRecordsTab.vue";
import DeclinesTab from "./DeclinesTab.vue";
import FillsTab from "./FillsTab.vue";

const listOf = () => ({
  data: ref({ rows: [{ id: "x", unit: "654", vehicle_id: null, tran_date: "2026-08-15", declined_at: "2026-08-15T14:00:00Z", fueled_at: "2026-08-15T14:00:00Z", gallons: 10, has_anomaly: false, case_level: "clear", case_signals: [], case_gates: null, state: "TX" }], total: 1 }),
  isLoading: ref(false), isError: ref(false), error: ref(null), refetch: vi.fn(), isFetching: ref(false),
});

/**
 * The shared window/truck the shell owns, stubbed with a real selection so the assertion below is
 * about a filter that is actually set — a stub with everything empty would pass for a component that
 * dropped the parameters entirely.
 */
const sharedStub = (): FuelLogSharedFilters =>
  ({
    tab: ref("fills"),
    from: ref("2026-08-01"),
    to: ref("2026-08-31"),
    units: ref(["654", "655"]),
    setFrom: () => {},
    setTo: () => {},
    setUnits: () => {},
    facet: () => ref(""),
    clear: () => {},
  }) as unknown as FuelLogSharedFilters;

/**
 * ⚠ `FilterBar` and `DataWorkspace` are stubbed with templates that RENDER THEIR SLOTS. A plain
 * shallow mount stubs both as empty elements, so the export button — which lives in the bar's
 * `#actions` slot, inside the workspace on one tab — is never created, and every assertion below
 * fails with "empty VueWrapper" rather than passing vacuously. Both took a red run to find, which is
 * the right direction for a stub to be wrong in.
 */
const hrefOf = async (tab: Component): Promise<string> => {
  const w = mount(tab, {
    shallow: true,
    props: { shared: sharedStub() },
    global: {
      plugins: [VueQueryPlugin, createPinia()],
      stubs: {
        FilterBar: { template: '<div><slot name="filters" /><slot name="more" /><slot name="actions" /></div>' },
        // Source records wraps its bar in a `DataWorkspace`, which shallow-stubs to an empty element
        // and swallows everything inside it — including the bar that holds the button.
        DataWorkspace: { template: "<div><slot /></div>" },
      },
    },
  });
  await flushPromises();
  return w.findComponent(ExportButton).props("href") as string;
};

describe("every tab offers its own list as a file, scoped to what it is showing", () => {
  it("puts the shared window and trucks on the fills export", async () => {
    expect(await hrefOf(FillsTab)).toContain("/api/fueling/exports/fills.csv?from=2026-08-01&to=2026-08-31&unit=654%2C655");
  });

  it("puts them on the declines export, at its own address", async () => {
    expect(await hrefOf(DeclinesTab)).toContain("/api/fueling/exports/declines.csv?from=2026-08-01&to=2026-08-31&unit=654%2C655");
  });

  it("puts them on the source-records export", async () => {
    expect(await hrefOf(SourceRecordsTab)).toContain("/api/fueling/exports/source-records.csv?from=2026-08-01&to=2026-08-31&unit=654%2C655");
  });
});
