import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";

/**
 * D-US4 — the same-card fills are drawn by `DataTable`, with this anomaly's own fill marked. The
 * desktop breakpoint is stubbed because jsdom has no `matchMedia` and DataTable would render cards.
 */
vi.mock("@vueuse/core", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useMediaQuery: () => ref(true) };
});
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));

const fill = (id: string, extra: Record<string, unknown> = {}) => ({
  id, vehicle_id: "v1", driver_id: "dr1", fueled_at: "2026-10-01T12:00:00Z", odometer: 1000,
  gallons: 101.5, price_per_gal: 3.5, location_text: null, city: "Joliet", state: "IL", ...extra,
});

const load = vi.hoisted(() => ({ siblingsFail: false, refetches: 0 }));
vi.mock("@/features/anomalies/useAnomalyDetail", () => ({
  useAnomalyDetail: () => ({
    txnLoading: ref(false), txnError: ref(null), txnFetching: ref(false), refetchTxn: vi.fn(),
    siblingError: ref(load.siblingsFail ? new Error("timeout") : null), siblingFetching: ref(false),
    refetchSiblings: () => { load.refetches++; },
    txn: ref({ ...fill("t1"), source: "efs", import_id: null, card_ref: "1234", total_cost: null, computed_mpg: null, samsara_location_matched: null }),
    transition: { isPending: ref(false), mutateAsync: vi.fn() },
    caseSignals: ref([]), isCase: ref(false), caseScore: ref(null), caseLevel: ref(undefined), caseAxes: ref([]),
    evidenceRows: ref([]),
    hasCardSignal: ref(true),
    cardRef: ref("1234"),
    windowHours: ref(48),
    siblingFills: ref([fill("t1"), fill("t2", { vehicle_id: "v2", price_per_gal: null, odometer: null, city: null, state: null })]),
    siblingLoading: ref(false),
    driverName: () => "Ann Lee",
    unitNumber: (id: string | null) => (id === "v1" ? "654" : "655"),
    vehicleDesc: () => "",
    tab: ref("overview"), orgTz: ref(null), odometerOffset: ref(0),
    axisClass: () => "", weightBarClass: () => "",
    fmt: () => "", fmtShort: () => "10/01 07:00",
    fmtOdo: (n: number | null) => (n != null ? n.toLocaleString() + " mi" : "—"),
    fmtMoney: (n: number | null) => (n != null ? "$" + n.toFixed(2) : "—"),
    formatKey: (k: string) => k,
    note: ref(""), disposition: ref(""), DISPOSITION_OPTIONS: [],
    doTransition: vi.fn(), doFalseAlarm: vi.fn(),
  }),
}));

import AnomalyDetail from "./AnomalyDetail.vue";
import DataTable from "@/components/ui/DataTable.vue";

describe("same-card fills table", () => {
  it("renders through DataTable with its columns, values and blanks as dashes", () => {
    const w = mount(AnomalyDetail, {
      props: {
        anomaly: { id: "a1", rule_id: "card_multi_vehicle", severity: "high", status: "open", message: "m", evidence: {} } as never,
        vehicleUnit: "654",
      },
      global: { stubs: { EntityHistory: true, AnomalyAudit: true, StatusBadge: true } },
    });
    const table = w.findComponent(DataTable);
    expect(table.exists()).toBe(true);
    expect(table.findAll("th").map((th) => th.text())).toEqual([
      "Vehicle", "When", "Gallons", "$/gal", "Odometer", "Driver", "Location",
    ]);
    const [mine, other] = table.findAll("tbody tr");
    expect(mine!.findAll("td").map((td) => td.text())).toEqual([
      "654 this fill", "10/01 07:00", "101.5", "$3.50", "1,000 mi", "Ann Lee", "Joliet, IL",
    ]);
    expect(other!.findAll("td").map((td) => td.text())).toEqual([
      "655", "10/01 07:00", "101.5", "—", "—", "Ann Lee", "—",
    ]);
  });
});

describe("same-card fills that fail to load (D-US5)", () => {
  it("says so and reads them again on Retry", async () => {
    load.siblingsFail = true;
    const w = mount(AnomalyDetail, {
      props: {
        anomaly: { id: "a1", rule_id: "card_multi_vehicle", severity: "high", status: "open", message: "m", evidence: {} } as never,
        vehicleUnit: "654",
      },
      global: { stubs: { EntityHistory: true, AnomalyAudit: true, StatusBadge: true } },
    });
    load.siblingsFail = false;
    expect(w.findComponent(DataTable).exists()).toBe(false);
    const alert = w.get("[role=alert]");
    expect(alert.text()).toContain("Could not load the related fills.");
    await alert.findAll("button").find((b) => b.text() === "Retry")!.trigger("click");
    expect(load.refetches).toBe(1);
  });
});
