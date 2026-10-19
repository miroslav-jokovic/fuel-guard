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
 *   5. **A withheld category shows a number, or a violation with no points shows a blank** instead of
 *      the reason the API gave (D-IC6), or the cap is said of the wrong figure.
 *   6. **The driver card is missing**, or the report still says the driver is not shown. What the card
 *      says is `InspectionDriverCard.test.ts`'s.
 *   7. **The documents card is missing**, or is asked about another inspection than the page's. What it
 *      says is `InspectionDocumentsCard.test.ts`'s.
 *   8. **The repair card is asked about another inspection** than the page's (IC11). What it says is
 *      `InspectionRepairCard.test.ts`'s.
 */

const inspection = ref<RoadsideInspectionDetailDto | undefined>(undefined);
const askedId = ref<string | undefined>(undefined);
const documentsAskedId = ref<string | undefined>(undefined);
const repairsAskedId = ref<string | undefined>(undefined);
vi.mock("@/features/roadside/useRoadsideInspections", async () => {
  const { ref: r, watchEffect } = await import("vue");
  return {
    useRoadsideInspectionQuery: (id: Ref<string>) => {
      watchEffect(() => (askedId.value = id.value));
      return { data: inspection, isLoading: r(false), isError: r(false), error: r(null), isFetching: r(false), refetch: vi.fn() };
    },
    useDecideAttribution: () => ({ mutate: vi.fn(), reset: vi.fn(), error: r(null), isPending: r(false) }),
    AttributionDecisionError: class extends Error {},
    useInspectionDocumentsQuery: (id: Ref<string>) => {
      watchEffect(() => (documentsAskedId.value = id.value));
      return { data: r([]), isLoading: r(false), isError: r(false), error: r(null), isFetching: r(false), refetch: vi.fn() };
    },
    useUploadInspectionDocument: () => ({ mutateAsync: vi.fn(), isPending: r(false) }),
    useInspectionRepairsQuery: (id: Ref<string>) => {
      watchEffect(() => (repairsAskedId.value = id.value));
      return { data: r([]), isLoading: r(false), isError: r(false), error: r(null), isFetching: r(false), refetch: vi.fn() };
    },
    useDecideRepair: () => ({ mutate: vi.fn(), reset: vi.fn(), error: r(null), isPending: r(false) }),
    useRepairCertificationQuery: () => ({ data: r(null) }),
    useInspectionCitationsQuery: () => ({ data: r({ tickets: [], courtResultFiled: false }), isLoading: r(false), isError: r(false), error: r(null), isFetching: r(false), refetch: vi.fn() }),
    useActOnCitation: () => ({ mutate: vi.fn(), reset: vi.fn(), error: r(null), isPending: r(false) }),
    useCertifyRepairs: () => ({ mutate: vi.fn(), error: r(null), isPending: r(false) }),
    RepairDecisionError: class extends Error {},
  };
});
vi.mock("@/composables/useOrgTimezone", async () => {
  const { ref: r } = await import("vue");
  return { useOrgTimezone: () => ({ zone: r("America/Chicago") }) };
});
let truckOpens = true;
vi.mock("@/composables/useOpens", () => ({ useOpens: () => () => truckOpens }));
vi.mock("@/composables/useDrivers", async () => {
  const { ref: r } = await import("vue");
  return { useDriversQuery: () => ({ data: r([]) }) };
});
// The desktop table: jsdom has no `matchMedia`, and DataTable would otherwise draw its narrow cards.
vi.mock("@vueuse/core", async (orig) => {
  const { ref: r } = await import("vue");
  return { ...((await orig()) as Record<string, unknown>), useMediaQuery: () => r(true) };
});

const RoadsideInspectionPage = (await import("@/pages/RoadsideInspectionPage.vue")).default;
const InspectionNextSteps = (await import("@/features/roadside/InspectionNextSteps.vue")).default;

const ID = "11111111-1111-4111-8111-111111111111";
async function page(attachTo?: HTMLElement) {
  const router = createRouter({ history: createMemoryHistory(), routes: [...ROUTE_TABLE] });
  await router.push(`/roadside-inspections/${ID}`);
  await router.isReady();
  const w = mount(RoadsideInspectionPage as never, { global: { plugins: [router] }, attachTo });
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
  sms: {
    measuredOn: "2026-10-14", appendixVersion: "3.21", timeWeight: 3, cap: 30,
    basics: [{ basic: "vehicle_maintenance", verified: true, severitySum: 34, capped: 30, points: 90 }],
    violations: {
      v1: { status: "excluded", basic: "unsafe_driving", reason: "dismissed" },
      v2: { status: "scored", basic: "vehicle_maintenance", severityWeight: 4, oosWeight: 2, timeWeight: 3, points: 18 },
    },
  },
  attribution: { reading: null, decision: null, basedOn: null, reports: [] },
  ...o,
});

beforeEach(() => {
  setActivePinia(createPinia());
  inspection.value = detail();
  askedId.value = undefined;
  truckOpens = true;
});

describe("one roadside inspection", () => {
  it("leads with what is left, then the violations with their CSA points as the header line, then the cards (Q-IC17)", async () => {
    const w = await page();
    const html = w.html();
    const at = (sel: string) => html.indexOf(sel);
    expect(at('data-test="next-steps"')).toBeGreaterThan(at('data-test="facts"'));
    expect(at('id="violations-heading"')).toBeGreaterThan(at('data-test="next-steps"'));
    expect(at('data-test="driver-card"')).toBeGreaterThan(at('id="violations-heading"'));
    expect(at('data-test="documents-card"')).toBeGreaterThan(at('data-test="driver-card"'));
    expect(w.get("[data-test='sms-total']").text()).toBe("Adds 90 CSA points today: Vehicle Maintenance 90.");
  });

  it("brings a step's card into view and focus, so a keyboard reader lands on the action", async () => {
    // In the document, as the page is: the step finds its card by id.
    const w = await page(document.body.appendChild(document.createElement("div")));
    const card = w.get("#inspection-driver").element as HTMLElement;
    const scrolled = vi.fn();
    card.scrollIntoView = scrolled;
    w.findComponent(InspectionNextSteps).vm.$emit("go", "driver");
    expect(scrolled).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
    expect(document.activeElement).toBe(card);
    w.unmount();
  });

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
    expect(w.findAll("[data-test='match']").map((m) => m.text())).toEqual(["Ours, by unit number", "Not on our current roster"]);
    expect(w.find("a[href='/vehicles/veh-701']").exists()).toBe(true);

    truckOpens = false;
    const denied = await page();
    expect(denied.find("a[href='/vehicles/veh-701']").exists()).toBe(false);
    expect(denied.findAll("[data-test='match']")[0]!.text()).toBe("Ours, by unit number");
  });

  it("has the driver card, and no longer says the driver is not shown", async () => {
    const w = await page();
    expect(w.get("[data-test='driver-pending']").text()).toContain("Samsara has not been read for this inspection yet");
    expect(w.text()).not.toContain("so it is not shown here");
  });

  it("has the documents card, asked about this inspection", async () => {
    const w = await page();
    expect(w.find("[data-test='documents-card']").exists()).toBe(true);
    expect(documentsAskedId.value).toBe(inspection.value!.id);
  });

  it("asks the repair card about this inspection", async () => {
    await page();
    expect(repairsAskedId.value).toBe(inspection.value!.id);
  });

  it("says when there are no violations, without calling the inspection clean (Q-FM8)", async () => {
    inspection.value = detail({ violations: 0, vehicleOos: 0, violationList: [] });
    const w = await page();
    expect(w.text()).toContain("No violations recorded on this inspection.");
    expect(w.text().toLowerCase()).not.toContain("clean");
  });

  it("gives each violation its CSA points with how they were reached, or the reason it has none", async () => {
    const w = await page();
    expect(w.findAll("[data-test='points']").map((c) => c.text())).toEqual(["None", "18"]);
    expect(w.findAll("[data-test='points-why']").map((c) => c.text())).toEqual([
      "The citation was dismissed in court.",
      "Vehicle Maintenance: severity 4 + 2 out of service, × 3",
    ]);
    const card = w.get("[data-test='sms']").text();
    expect(card).toContain("10/14/2026");
    expect(card).toContain("under 6 months old");
    expect(w.get("[data-test='sms-basic']").text()).toBe("Vehicle Maintenance — 34, capped at 30 × 3 = 90 points");
  });

  it("withholds a category the calculator does not match FMCSA in, and says why on the row and in the total", async () => {
    inspection.value = detail({
      sms: {
        measuredOn: "2026-10-14", appendixVersion: "3.21", timeWeight: 3, cap: 30,
        basics: [{ basic: "hm_compliance", verified: false }],
        violations: { v1: { status: "withheld", basic: "hm_compliance" }, v2: { status: "excluded", basic: "vehicle_maintenance", reason: "level_not_relevant" } },
      },
    });
    const w = await page();
    expect(w.findAll("[data-test='points']").map((c) => c.text())).toEqual(["Not shown", "None"]);
    expect(w.findAll("[data-test='points-why']")[0]!.text()).toMatch(/charges to the shipper/);
    const total = w.get("[data-test='sms-basic']").text();
    expect(total).toMatch(/^Hazardous Materials Compliance — Points not shown/);
    expect(total).not.toMatch(/\d+ points/);
  });

  it("says no violation adds points rather than showing an empty total", async () => {
    inspection.value = detail({
      sms: { measuredOn: "2026-10-14", appendixVersion: "3.21", timeWeight: null, cap: 30, basics: [], violations: {
        v1: { status: "excluded", basic: "unsafe_driving", reason: "outside_window" },
        v2: { status: "excluded", basic: "vehicle_maintenance", reason: "outside_window" },
      } },
    });
    const w = await page();
    expect(w.get("[data-test='sms-none']").text()).toBe("No violation on this inspection adds CSA points; each row says why.");
    expect(w.get("[data-test='sms']").text()).not.toContain("This inspection is");
    expect(w.findAll("[data-test='points-why']").map((c) => c.text())).toEqual(Array(2).fill("Older than 24 months, so SMS no longer counts it."));
  });
});
