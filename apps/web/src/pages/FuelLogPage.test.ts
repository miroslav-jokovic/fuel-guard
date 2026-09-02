import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";

/**
 * The Fuel Log, mounted — specifically, the column that is NOT there (FUEL-T4, D-FUI14).
 *
 * WHY THIS SUITE EXISTS. This page used to render the truck's CURRENTLY paired trailer beside every
 * fill, including fills from months ago. There is nothing historical to render instead:
 * `duty_equipment_segments` holds 0 rows (re-measured in production 2026-09-02) and
 * `trailers.assigned_vehicle_id` is current-state by construction, with 157 of 211 trailers carrying
 * one. So the column was not approximately right — it was a live fact presented as a historical one,
 * which is the confident-wrong-answer shape D-FUI14 exists to forbid.
 *
 * A removal leaves nothing behind to notice, which is exactly why it needs a test: the column is one
 * line of a column array and a helper that still reads plausibly, so re-adding it is a two-minute
 * change that looks like an improvement. This is the pin that makes someone argue with the decision
 * (Q-FUI8) instead of quietly reversing it.
 */

const rows = [
  {
    id: "f1",
    vehicle_id: "v1",
    driver_id: "d1",
    fueled_at: "2026-08-15T14:00:00Z",
    business_date: "2026-08-15",
    gallons: 100,
    total_cost: 400,
    odometer: 100_000,
    has_anomaly: false,
    case_level: "clear",
    case_score: 0,
    case_signals: [],
    case_gates: null,
  },
];

vi.mock("@/features/fuel/useFuelLog", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    useFuelTransactions: () => ({
      data: ref({ rows, count: rows.length }),
      isLoading: ref(false),
      isError: ref(false),
      error: ref(null),
      refetch: vi.fn(),
      isFetching: ref(false),
    }),
    useFuelRangeTotals: () => ({
      data: ref({ flagged: 0, clear: 1, totalGallons: 100, totalCost: 400, hasCost: true, fleetMpg: 6.5 }),
    }),
    useCreateFillUp: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }),
  };
});

vi.mock("@/composables/useVehicles", () => ({
  useVehiclesQuery: () => ({ data: ref([{ id: "v1", unit_number: "701", status: "active" }]) }),
}));
vi.mock("@/composables/useDrivers", () => ({
  useDriversQuery: () => ({ data: ref([{ id: "d1", full_name: "A Driver" }]) }),
}));

// The trailer roster query the removed column used to read. If it comes back, this spy sees it.
//
// ⚠ `vi.hoisted`, not a plain const. `vi.mock` factories are hoisted above module-level bindings, so a
// top-level spy referenced inside one throws "Cannot access before initialization" — and it throws
// only when the mock is actually LOADED, i.e. exactly when someone re-adds the trailer import. The
// suite would then fail with a hoisting error instead of naming the regression, which is a worse
// failure than none: it looks like a broken test rather than a reversed decision.
const { trailersQuery, TRAILER_UNIT } = vi.hoisted(() => {
  const TRAILER_UNIT = "R-42";
  return {
    TRAILER_UNIT,
    // `ref` is called lazily, when the page asks — by then the module graph is loaded.
    trailersQuery: vi.fn(() => ({
      data: { value: [{ id: "t1", unit_number: TRAILER_UNIT, assigned_vehicle_id: "v1", status: "active" }] },
    })),
  };
});
vi.mock("@/composables/useTrailers", () => ({ useTrailersQuery: trailersQuery }));

// DataTable switches to a card layout below 768px, and jsdom reports no matchMedia support at all —
// so without this the table renders as cards, `th` is empty, and an assertion that "Trailer" is not
// among the headers passes because there are NO headers. That is the vacuous-pass shape this repo
// keeps finding; the desktop breakpoint is stubbed so the real table is what gets asserted.
vi.mock("@vueuse/core", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useMediaQuery: () => ref(true) };
});

import FuelLogPage from "./FuelLogPage.vue";

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/fuel-log", component: { template: "<div/>" }, meta: { title: "Fuel Log" } }],
  });
  await router.push("/fuel-log");
  await router.isReady();
  const pinia = createPinia();
  setActivePinia(pinia);
  const w = mount(FuelLogPage, { global: { plugins: [router, pinia] } });
  await flushPromises();
  return w;
}

describe("FuelLogPage — the Trailer column is gone, and stays gone (D-FUI14)", () => {
  it("shows no Trailer column header", async () => {
    const headers = (await mountPage()).findAll("th").map((h) => h.text().trim());
    expect(headers).not.toContain("Trailer");
    // The columns that DO belong are still there, so this is not passing because the table failed to render.
    expect(headers).toEqual(expect.arrayContaining(["Vehicle", "Driver"]));
  });

  it("never renders the currently-paired trailer against a historical fill", async () => {
    // R-42 is paired to truck 701 TODAY. The fill is from August. If the unit number appears anywhere
    // on this page, a live fact is being shown beside a historical row — the exact defect T4 removed.
    expect((await mountPage()).text()).not.toContain(TRAILER_UNIT);
  });

  it("does not even ask for the trailer roster — the capability is removed, not hidden", async () => {
    trailersQuery.mockClear();
    await mountPage();
    expect(trailersQuery).not.toHaveBeenCalled();
  });
});
