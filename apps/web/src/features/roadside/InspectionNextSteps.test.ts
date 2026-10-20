import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import type { RoadsideAttributionDto, RoadsideInspectionCitationsDto, RoadsideRepairCertificationDto, RoadsideRepairDto } from "@silvicom/shared";

/**
 * The Next steps strip on the Inspection page (Q-IC17, IC15). The rule is `roadsideNextSteps`'s and is
 * tested there; what the strip itself can get wrong:
 *
 *   1. **It speaks before the repair record has loaded**, saying "Nothing left to do" and then growing steps.
 *   2. **The clock reads the browser's day** rather than the carrier's.
 *   3. **The count hides whose steps they are** — maintenance's steps counted as the reader's.
 *   4. **A step's button goes nowhere**, or shows on a step nobody can act on yet.
 */

const repairs = ref<RoadsideRepairDto[] | undefined>(undefined);
const loading = ref(true);
const certification = ref<RoadsideRepairCertificationDto | null | undefined>(null);
const citations = ref<RoadsideInspectionCitationsDto>({ tickets: [], courtPapers: [], filing: null as never });
vi.mock("./useRoadsideInspections", () => ({
  useInspectionRepairsQuery: () => ({ data: repairs, isLoading: loading, isError: ref(false), error: ref(null), isFetching: ref(false), refetch: vi.fn() }),
  useRepairCertificationQuery: () => ({ data: certification }),
  useInspectionCitationsQuery: () => ({ data: citations }),
}));
// The org is in Los Angeles; the test runs at 2026-10-17 04:00 UTC, which is still 10-16 there.
vi.mock("@/composables/useOrgTimezone", () => ({ useOrgTimezone: () => ({ zone: ref("America/Los_Angeles") }) }));

const InspectionNextSteps = (await import("./InspectionNextSteps.vue")).default;

const strong: RoadsideAttributionDto = {
  reading: {
    id: "eng-1", engineVersion: "ic5.1", readAt: "2026-10-14T10:00:00Z", outcome: "one_driver", confidence: "high", basis: "covering",
    zone: "America/Denver", zoneMethod: "gps", startedAt: null, endedAt: null, locationCheck: "confirmed",
    samsaraDriver: { id: "s-ann", name: "Ann (Samsara)" }, driver: { id: "d-ann", name: "Ann Roster" }, candidates: [],
  },
  decision: null,
  basedOn: "eng-1",
  reports: [],
};
const repair = (o: Partial<RoadsideRepairDto> = {}): RoadsideRepairDto => ({
  unitId: "u-1", unit: { seq: 1, kind: "tractor", companyNumber: "612" }, violations: [], dueOn: "2026-10-19",
  proposal: { outcome: "no_candidate", candidates: [], readAt: "x" }, decision: null, basedOn: "r-1", ...o,
});

async function strip(attribution: RoadsideAttributionDto = strong) {
  const w = mount(InspectionNextSteps, { props: { inspectionId: "insp-1", inspectionDate: "2026-10-04", attribution } });
  await flushPromises();
  return w;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-17T04:00:00Z"));
  repairs.value = [];
  loading.value = false;
  certification.value = null;
  citations.value = { tickets: [], courtPapers: [], filing: null as never };
});

describe("the Next steps strip", () => {
  it("says nothing about what is left until the repair record has loaded", async () => {
    repairs.value = undefined;
    loading.value = true;
    const w = await strip();
    expect(w.find("[data-test='next-steps-summary']").exists()).toBe(false);
    expect(w.find("[data-test='step-driver']").exists()).toBe(false);
  });

  it("says nothing is left when the driver is Samsara's strong reading and there is no repair", async () => {
    const w = await strip();
    expect(w.get("[data-test='next-steps-summary']").text()).toBe("Nothing left to do");
    expect(w.get("[data-test='step-driver']").text()).toContain("Driver: Ann Roster · from Samsara");
    expect(w.find("[data-test='step-go-driver']").exists()).toBe(false);
  });

  it("counts the open steps and says how many are maintenance's, with the clock on the carrier's calendar", async () => {
    repairs.value = [repair()];
    const w = await strip();
    expect(w.get("[data-test='next-steps-summary']").text()).toBe("2 open · 1 for maintenance");
    // Due 10-19, and it is 10-16 in Los Angeles — three days, not the two a UTC clock would give.
    expect(w.get("[data-test='step-repair:u-1'] [data-test='step-due']").text()).toBe("Due 10/19/2026 · 3 days left");
    expect(w.get("[data-test='step-certify']").attributes("data-state")).toBe("waiting");
    expect(w.find("[data-test='step-go-certify']").exists()).toBe(false);
  });

  it("sends the reader to the card where a step is done", async () => {
    repairs.value = [repair()];
    const w = await strip();
    await w.get("[data-test='step-go-repair:u-1']").trigger("click");
    await w.get("[data-test='step-go-report']").trigger("click");
    expect(w.emitted("go")).toEqual([["repair"], ["documents"]]);
  });

  it("asks what a court paper filed on the inspection decided about each ticket", async () => {
    citations.value = {
      tickets: [{ violationId: "v-1", code: "392.2", description: "Speeding", citationNumber: "E061", courtResults: [], action: null, disposition: null, dataqsCase: null }],
      courtPapers: [{ id: "doc-1", filedAt: "2026-10-15T00:00:00Z" }],
      filing: null as never,
    };
    const w = await strip();
    expect(w.get("[data-test='step-citation:v-1']").text()).toContain("Ticket E061: record what the court decided");
  });
});
