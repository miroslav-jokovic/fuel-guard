import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { ref, type Ref } from "vue";
import type { RoadsideInspectionDetailDto } from "@silvicom/shared";
import { ROUTE_TABLE } from "@/router/table";

/**
 * One roadside inspection (INSPECTION-CHALLENGE-PLAN §6, the Inspection page's first slice). What it can
 * get wrong that the API's test would not see:
 *
 *   1. **A violation reads as against the wrong thing** — "2" is the report's second unit, not unit 2 of
 *      ours, and "D" is the driver.
 *   2. **A unit reads as ours when it is not**, or as ours with no word on how (D-IC7, 0458).
 *   3. **The truck link shows to a reader the router would bounce** (SP5).
 *   4. **The report's local clock is shifted or the level is given a name** the sources do not hold.
 */

const inspection = ref<RoadsideInspectionDetailDto | undefined>(undefined);
const askedId = ref<string | undefined>(undefined);
vi.mock("@/features/roadside/useRoadsideInspections", async () => {
  const { ref: r, watchEffect } = await import("vue");
  return {
    useRoadsideInspectionQuery: (id: Ref<string>) => {
      watchEffect(() => (askedId.value = id.value));
      return { data: inspection, isLoading: r(false), isError: r(false), error: r(null), isFetching: r(false), refetch: vi.fn() };
    },
  };
});
let truckOpens = true;
vi.mock("@/composables/useOpens", () => ({ useOpens: () => () => truckOpens }));
// The desktop table: jsdom has no `matchMedia`, and DataTable would otherwise draw its narrow cards.
vi.mock("@vueuse/core", async (orig) => {
  const { ref: r } = await import("vue");
  return { ...((await orig()) as Record<string, unknown>), useMediaQuery: () => r(true) };
});

const RoadsideInspectionPage = (await import("@/pages/RoadsideInspectionPage.vue")).default;

const ID = "11111111-1111-4111-8111-111111111111";
async function page() {
  const router = createRouter({ history: createMemoryHistory(), routes: [...ROUTE_TABLE] });
  await router.push(`/roadside-inspections/${ID}`);
  await router.isReady();
  const w = mount(RoadsideInspectionPage as never, { global: { plugins: [router] } });
  await flushPromises();
  return w;
}

const detail = (o: Partial<RoadsideInspectionDetailDto> = {}): RoadsideInspectionDetailDto => ({
  id: ID, reportNumber: "IL0912", reportState: "IL", inspectionDate: "2026-10-09", level: 2, locationDesc: "I-55 MM 210",
  hazmatPlacardRequired: true, violations: 2, driverOos: 0, vehicleOos: 1, hazmatOos: 0,
  startTime: "0851", endTime: "0911", facility: "fixed", postAccident: false, shipperName: null, grossWeightLb: 78500, oosTotal: 1,
  units: [
    { seq: 1, kind: "tractor", companyNumber: "701", plate: "P1", plateState: "IL", matched: true, make: "FRHT", vin: "1FUJ", decal: false, matchedBy: "unit_number", vehicleId: "veh-701" },
    { seq: 2, kind: "trailer", companyNumber: "5301", plate: "T998", plateState: "WI", matched: false, make: "WABASH", vin: "1JJV", decal: null, matchedBy: null, vehicleId: null },
  ],
  violationList: [
    { id: "v1", seq: 1, code: "392.2-SLLS1", description: "Speeding 1-5 mph", against: { driver: true }, outOfService: false, category: "Speeding", defectVerification: "Not out of service", citationNumber: "E061", courtResults: ["Not Guilty/Dismissed"] },
    { id: "v2", seq: 2, code: "393.47D2", description: "Drum brake lining", against: { unitSeq: 2 }, outOfService: true, category: "Brakes, All Other Violations", defectVerification: "Repaired at scene", citationNumber: null, courtResults: [] },
  ],
  ...o,
});

beforeEach(() => {
  setActivePinia(createPinia());
  inspection.value = detail();
  askedId.value = undefined;
  truckOpens = true;
});

describe("one roadside inspection", () => {
  it("asks for the inspection in the URL and shows the report's facts as written", async () => {
    const w = await page();
    expect(askedId.value).toBe(ID);
    expect(w.text()).toContain("Report IL0912");
    const facts = w.get("[data-test='facts']").text();
    expect(facts).toContain("10/09/2026");
    expect(facts).toContain("08:51–09:11");
    expect(facts).toContain("Fixed site");
    expect(facts).toContain("78,500 lb");
    expect(facts).toMatch(/Level\s*2 · Walk-Around/);
  });

  it("says who each violation is against — the driver, or the report's unit by its position", async () => {
    const w = await page();
    const rows = w.findAll("tbody tr").map((r) => r.text());
    expect(rows[0]).toContain("Driver");
    expect(rows[0]).toContain("Not Guilty/Dismissed");
    expect(rows[1]).toContain("Unit 2 · Trailer 5301");
    expect(w.findAll("[data-test='oos']")).toHaveLength(1);
    expect(w.findAll("[data-test='category']").map((c) => c.text())).toEqual(["Speeding", "Brakes, All Other Violations"]);
    // The defect's outcome shows beside an order only: "Not out of service" on v1 would be noise.
    expect(w.findAll("[data-test='defect']").map((c) => c.text())).toEqual(["Repaired at scene"]);
  });

  it("marks each unit ours with how it matched, or not matched — and links the truck only when it opens", async () => {
    const w = await page();
    expect(w.findAll("[data-test='match']").map((m) => m.text())).toEqual(["Ours, by unit number", "Not matched to ours"]);
    expect(w.find("a[href='/vehicles/veh-701']").exists()).toBe(true);

    truckOpens = false;
    const denied = await page();
    expect(denied.find("a[href='/vehicles/veh-701']").exists()).toBe(false);
    expect(denied.findAll("[data-test='match']")[0]!.text()).toBe("Ours, by unit number");
  });

  it("says when there are no violations, without calling the inspection clean (Q-FM8)", async () => {
    inspection.value = detail({ violations: 0, vehicleOos: 0, violationList: [] });
    const w = await page();
    expect(w.text()).toContain("No violations recorded on this inspection.");
    expect(w.text().toLowerCase()).not.toContain("clean");
  });
});
