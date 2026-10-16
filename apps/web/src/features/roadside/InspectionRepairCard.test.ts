import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import type { RoadsideRepairCertificationDto, RoadsideRepairDto } from "@silvicom/shared";

/**
 * The Repair card on the Inspection page (IC11, D-IC14). What it can get wrong that the API's tests would
 * not see:
 *
 *   1. **The clock reads the browser's day**, or counts "due today" as overdue.
 *   2. **The decide buttons show to a reader without maintenance's manage level** — safety's is not it (Q-IC13).
 *   3. **A work order is accepted without the row the page showed**, so a re-read could be overwritten unseen.
 *   4. **A unit that needs no decision** (repaired at the scene) still offers one — or a unit FMCSA could not
 *      tie to us offers none, and the inspection can never be certified.
 *   5. **The card shows for an inspection with no vehicle violation**, as an empty box.
 *   6. **Certify shows before every unit is settled**, or to a reader without safety's manage level, or over a
 *      certification that still stands; or it sends a record other than the one shown (IC11 B2).
 */

const mutate = vi.fn();
const reset = vi.fn();
const repairs = ref<RoadsideRepairDto[] | undefined>([]);
const decideError = ref<Error | null>(null);
const certifyMutate = vi.fn();
const certification = ref<RoadsideRepairCertificationDto | null | undefined>(null);
let sections = new Set(["safety", "maintenance"]);
vi.mock("./useRoadsideInspections", () => ({
  useInspectionRepairsQuery: () => ({ data: repairs, isLoading: ref(false), isError: ref(false), error: ref(null), isFetching: ref(false), refetch: vi.fn() }),
  useDecideRepair: () => ({ mutate, reset, isPending: ref(false), error: decideError }),
  useRepairCertificationQuery: () => ({ data: certification }),
  useCertifyRepairs: () => ({ mutate: certifyMutate, isPending: ref(false), error: ref(null) }),
  RepairDecisionError: class extends Error {
    constructor(m: string, readonly code: string | null) {
      super(m);
    }
  },
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: (s: string) => sections.has(s) }) }));
// The org is in Los Angeles; the test runs at 2026-10-17 04:00 UTC, which is still 10-16 there.
vi.mock("@/composables/useOrgTimezone", () => ({ useOrgTimezone: () => ({ zone: ref("America/Los_Angeles") }) }));

const InspectionRepairCard = (await import("./InspectionRepairCard.vue")).default;

const candidate = (id: string, ref_: string) => ({ workOrderId: id, reference: ref_, openedOn: "2026-10-07", status: "CLOSED", completedAt: null, description: null, jobs: ["Brake chamber", "Adjust slack"] });
const repair = (o: Partial<RoadsideRepairDto> = {}): RoadsideRepairDto => ({
  unitId: "u-1",
  unit: { seq: 1, kind: "tractor", companyNumber: "1234" },
  violations: [{ code: "393.47D", description: "Brakes out of adjustment" }],
  dueOn: "2026-10-21",
  proposal: { outcome: "several_candidates", candidates: [candidate("wo-1", "WO-101"), candidate("wo-2", "WO-102")], readAt: "2026-10-16T12:00:00Z" },
  decision: null,
  basedOn: "row-7",
  ...o,
});

async function card() {
  const w = mount(InspectionRepairCard, { props: { inspectionId: "insp-1" } });
  await flushPromises();
  return w;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-17T04:00:00Z"));
  mutate.mockReset();
  reset.mockReset();
  repairs.value = [repair()];
  decideError.value = null;
  certifyMutate.mockReset();
  certification.value = null;
  sections = new Set(["safety", "maintenance"]);
});

describe("the clock", () => {
  it("counts days left on the carrier's calendar", async () => {
    const w = await card();
    expect(w.get("[data-test='repair-badge']").text()).toBe("5 days left");
    expect(w.text()).toContain("Due 10/21/2026");
  });

  it("says due today, then overdue", async () => {
    repairs.value = [repair({ dueOn: "2026-10-16" })];
    expect((await card()).get("[data-test='repair-badge']").text()).toBe("Due today");
    repairs.value = [repair({ dueOn: "2026-10-14" })];
    expect((await card()).get("[data-test='repair-badge']").text()).toBe("Overdue 2 days");
  });
});

describe("deciding", () => {
  it("lists each proposed work order with its jobs, and accepts the one chosen over the row shown", async () => {
    const w = await card();
    const items = w.findAll("[data-test='repair-candidate']");
    expect(items.map((i) => i.text().split(" ·")[0]!.trim())).toEqual(["WO-101", "WO-102"]);
    expect(items[0]!.text()).toContain("Brake chamber, Adjust slack");
    await items[1]!.get("[data-test='repair-accept']").trigger("click");
    expect(mutate).toHaveBeenCalledWith({ action: "accept", unitId: "u-1", basedOn: "row-7", workOrderId: "wo-2" });
  });

  it("records a repair outside FleetPal only with where it was done", async () => {
    const w = await card();
    await w.get("[data-test='repair-outside']").trigger("click");
    expect(w.get("[data-test='repair-outside-save']").attributes("disabled")).toBeDefined();
    await w.get("textarea").setValue("TA Joliet, invoice 8812");
    await w.get("[data-test='repair-outside-form']").trigger("submit");
    expect(mutate).toHaveBeenCalledWith({ action: "outside", unitId: "u-1", basedOn: "row-7", note: "TA Joliet, invoice 8812" }, expect.anything());
  });

  it("⚠ offers no decision to a reader who manages safety but not maintenance", async () => {
    sections = new Set(["safety"]);
    const w = await card();
    expect(w.findAll("[data-test='repair-accept']")).toHaveLength(0);
    expect(w.find("[data-test='repair-outside']").exists()).toBe(false);
    expect(w.findAll("[data-test='repair-candidate']")).toHaveLength(2);
  });

  it("offers nothing to decide on a unit repaired at the scene, and says so", async () => {
    repairs.value = [repair({ proposal: { outcome: "repaired_at_scene", candidates: [], readAt: "2026-10-16T12:00:00Z" } })];
    const w = await card();
    expect(w.get("[data-test='repair-badge']").text()).toBe("Repaired at the scene");
    expect(w.find("[data-test='repair-outside']").exists()).toBe(false);
  });

  it("offers 'outside FleetPal' on a unit FMCSA could not tie to our fleet", async () => {
    repairs.value = [repair({ proposal: { outcome: "unit_not_ours", candidates: [], readAt: "2026-10-16T12:00:00Z" } })];
    expect((await card()).find("[data-test='repair-outside']").exists()).toBe(true);
  });

  it("shows the decision with who made it, and closes the clock", async () => {
    repairs.value = [repair({ decision: { outcome: "accepted", workOrder: candidate("wo-2", "WO-102"), note: null, decidedBy: "Pat Shop", decidedAt: "2026-10-16T15:00:00Z" } })];
    const w = await card();
    expect(w.get("[data-test='repair-badge']").text()).toBe("Repair recorded");
    expect(w.get("[data-test='repair-decision']").text()).toContain("WO-102");
    expect(w.get("[data-test='repair-decision']").text()).toContain("Pat Shop");
  });

  it("explains a refusal because the record changed", async () => {
    const { RepairDecisionError } = await import("./useRoadsideInspections");
    decideError.value = new RepairDecisionError("stale", "changed");
    expect((await card()).get("[data-test='repair-error']").text()).toContain("changed while the page was open");
  });
});

it("is not shown for an inspection with no vehicle violation", async () => {
  repairs.value = [];
  expect((await card()).find("[data-test='repair-card']").exists()).toBe(false);
});

describe("certifying (IC11 B2, Q-IC13)", () => {
  const decided = (unitId: string, basedOn: string) =>
    repair({ unitId, basedOn, decision: { outcome: "repaired_outside_fleetpal", workOrder: null, note: "TA Joliet", decidedBy: "Pat Shop", decidedAt: "2026-10-16T15:00:00Z" } });
  const scene = repair({ unitId: "u-2", basedOn: "row-9", proposal: { outcome: "repaired_at_scene", candidates: [], readAt: "2026-10-16T12:00:00Z" } });
  const cert = (current: boolean): RoadsideRepairCertificationDto => ({
    id: "c-1", signerName: "Dana Reyes", signerTitle: "Safety Director", signedOn: "2026-10-16", certifiedAt: "2026-10-16T17:30:00Z", documentId: "d-1", current,
  });

  it("⚠ waits until every unit's repair is recorded", async () => {
    repairs.value = [decided("u-1", "row-7"), repair({ unitId: "u-3", basedOn: "row-3" })];
    const w = await card();
    expect(w.find("[data-test='repair-certify-form']").exists()).toBe(false);
    expect(w.get("[data-test='repair-certification-waits']").exists()).toBe(true);
  });

  it("certifies with the title given, over every unit's row as shown", async () => {
    repairs.value = [decided("u-1", "row-7"), scene];
    const w = await card();
    expect(w.get("[data-test='repair-certify']").attributes("disabled")).toBeDefined();
    await w.get("[data-test='repair-certify-title']").setValue("  Safety Director ");
    await w.get("[data-test='repair-certify-form']").trigger("submit");
    expect(certifyMutate).toHaveBeenCalledWith({ signerTitle: "Safety Director", basedOn: ["row-7", "row-9"] });
  });

  it("⚠ offers no certification to a reader who manages maintenance but not safety", async () => {
    sections = new Set(["maintenance"]);
    repairs.value = [decided("u-1", "row-7")];
    expect((await card()).find("[data-test='repair-certify-form']").exists()).toBe(false);
  });

  it("shows a standing certification and offers no second one", async () => {
    repairs.value = [decided("u-1", "row-7")];
    certification.value = cert(true);
    const w = await card();
    expect(w.get("[data-test='repair-certified']").text()).toContain("Dana Reyes, Safety Director, on 10/16/2026");
    expect(w.find("[data-test='repair-certify-form']").exists()).toBe(false);
  });

  it("⚠ asks again once a repair changed after the certification", async () => {
    repairs.value = [decided("u-1", "row-8")];
    certification.value = cert(false);
    const w = await card();
    expect(w.get("[data-test='repair-certification-stale']").text()).toContain("Certify again");
    expect(w.find("[data-test='repair-certify-form']").exists()).toBe(true);
  });
});
