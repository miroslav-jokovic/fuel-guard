import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import { useConfirmStore } from "@silvicom/ui";

/**
 * The applicant record's employment section (D1) — the coverage summaries (D-US6), and since HW5b the
 * one timeline and the one employer form on the office record's own save path (EM-5, EM-6).
 */
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("admin");
  return { useSessionStore: () => s };
});
vi.mock("@/composables/useDrivers", () => ({ useDriverQuery: () => ({ data: ref({ hire_date: "2026-01-15" }) }) }));
const DRIVER = "11111111-1111-4111-8111-111111111111";
const ROW = {
  id: "22222222-2222-4222-8222-222222222222", driver_id: DRIVER, employer_name: "Old Carrier", usdot_number: null,
  employer_address_line1: "12 Depot Rd", employer_city: "Joliet", employer_state: "IL", employer_phone: null,
  employer_email: null, position_held: "Driver", started_on: "2022-01-01", ended_on: null,
  dot_regulated: true, operated_cmv: true, subject_to_fmcsr: true, safety_sensitive: true, reason_for_leaving: "Moved",
  inquiry_status: "sent", inquiry_sent_on: "2024-02-01", inquiry_response_on: null,
  source: "application", notes: null, created_at: "2024-01-01T00:00:00Z", updated_at: "2024-01-01T00:00:00Z",
};
const rows = ref<unknown[]>([]);
const mutations = vi.hoisted(() => ({ add: vi.fn(), update: vi.fn(), remove: vi.fn() }));
const mutation = (fn: ReturnType<typeof vi.fn>) => () => ({ mutateAsync: fn, isPending: ref(false) });
vi.mock("@/features/recruitment/useEmployment", () => ({
  useEmploymentHistoryQuery: () => ({
    data: rows, isLoading: ref(false), isError: ref(false), error: ref(null), isFetching: ref(false), refetch: vi.fn(),
  }),
  useAddEmployment: mutation(mutations.add),
  useUpdateEmployment: mutation(mutations.update),
  useRemoveEmployment: mutation(mutations.remove),
}));
// HW5c: the gaps read and writes, as the tests below set them.
const gapsView = ref<unknown>({ recorded: [], applicant: [] });
const gapMutations = vi.hoisted(() => ({ record: vi.fn(), withdraw: vi.fn() }));
vi.mock("@/features/recruitment/useEmploymentGaps", () => ({
  useEmploymentGapsQuery: () => ({ data: gapsView }),
  useRecordEmploymentGap: mutation(gapMutations.record),
  useWithdrawEmploymentGap: mutation(gapMutations.withdraw),
}));
const EmploymentHistorySection = (await import("./EmploymentHistorySection.vue")).default;

const SlideOverStub = {
  template: "<div v-if='open'><slot /><slot name='footer' /></div>",
  props: ["open", "title", "size", "description"],
};
const section = () =>
  mount(EmploymentHistorySection, { props: { driverId: DRIVER }, global: { stubs: { SlideOver: SlideOverStub } }, attachTo: document.body });
const press = async (w: ReturnType<typeof section>, label: string) => {
  await w.findAll("button").find((b) => b.text().trim() === label)!.trigger("click");
  await flushPromises();
};

beforeEach(() => {
  setActivePinia(createPinia());
  rows.value = [];
  for (const m of Object.values(mutations)) m.mockReset().mockResolvedValue({});
});

describe("the employment coverage summaries", () => {
  it("pairs each count with its label in both lists", () => {
    const w = section();
    const [all, cmv] = w.findAll("dl");
    expect(all!.findAll("dt").map((d) => d.text())).toEqual(["Employers", "Gaps", "Inquiries due"]);
    expect(all!.findAll("dd").map((d) => d.text())[0]).toBe("0");
    expect(all!.findAll("dd").map((d) => d.text())[2]).toBe("None");
    expect(cmv!.findAll("dt").map((d) => d.text())).toEqual(["CMV employers", "Other listed"]);
    expect(cmv!.findAll("dd").map((d) => d.text())).toEqual(["0", "0"]);
    w.unmount();
  });
});

describe("the record on the one timeline (HW5b)", () => {
  it("shows each job with its inquiry status and where it came from", () => {
    rows.value = [ROW];
    const w = section();
    const card = w.get(`[data-job="${ROW.id}"]`).text();
    expect(card).toContain("Old Carrier");
    expect(card).toContain("01/01/2022 – now");
    expect(card).toContain("Declared on the application");
    w.unmount();
  });

  it("EM-5: an office add is saved as added by the office, with its street, and no inquiry status typed", async () => {
    const w = section();
    await press(w, "Add employer");
    await w.find("#record-employer-employer_name").setValue("Werner");
    w.findAllComponents({ name: "AppDateField" }).find((d) => d.html().includes('id="record-employer-started_on"'))!
      .vm.$emit("update:modelValue", "2023-03-01");
    await w.find("#record-employer-address_line1").setValue("1 Frontier Rd");
    await flushPromises();
    await press(w, "Save this job");
    expect(mutations.add).toHaveBeenCalledTimes(1);
    const body = mutations.add.mock.calls[0]![0];
    expect(body).toMatchObject({ source: "manual", employer_name: "Werner", employer_address_line1: "1 Frontier Rd", operated_cmv: true });
    expect(body).not.toHaveProperty("inquiry_sent_on");
    // EM-6: the form has no inquiry boxes at all.
    expect(w.find("#record-employer-inquiry_status").exists()).toBe(false);
    w.unmount();
  });

  it("EM-5: Remove asks first, and removes the row only on yes", async () => {
    rows.value = [ROW];
    const w = section();
    await w.get(`[data-job="${ROW.id}"] button`).trigger("click");
    await flushPromises();
    await press(w, "Remove this job");
    expect(mutations.remove).not.toHaveBeenCalled();
    useConfirmStore().answer(true);
    await flushPromises();
    expect(mutations.remove).toHaveBeenCalledWith({ id: ROW.id, driverId: DRIVER });
    w.unmount();
  });
});

describe("HW5c: gaps after signing", () => {
  // Two jobs with a gap between them: 2025-03-01 – 2025-05-31.
  const JOBS = [
    { ...ROW, id: "j1", employer_name: "First", started_on: "2023-01-01", ended_on: "2025-03-01" },
    { ...ROW, id: "j2", employer_name: "Second", started_on: "2025-06-01", ended_on: null },
  ];
  const RECORDED = (over: Record<string, unknown> = {}) => ({
    id: "g1", startedOn: "2025-03-10", endedOn: "2025-05-01", explanation: "Cared for a parent",
    recordedByName: "Dana", createdAt: "2026-11-01T10:00:00Z", withdrawnAt: null, ...over,
  });

  beforeEach(() => {
    rows.value = JOBS;
    gapsView.value = { recorded: [], applicant: [] };
    gapMutations.record.mockReset().mockResolvedValue({});
    gapMutations.withdraw.mockReset().mockResolvedValue({});
  });

  it("records an explanation for a drawn gap with the gap's own dates", async () => {
    const w = section();
    await flushPromises();
    const box = w.get("[data-record-gap]");
    expect(box.text()).toContain("Not explained yet.");
    await box.findAll("button").find((b) => b.text() === "Explain this gap")!.trigger("click");
    await box.get("textarea").setValue("  Cared for a parent  ");
    await box.findAll("button").find((b) => b.text() === "Record it")!.trigger("click");
    await flushPromises();
    expect(gapMutations.record).toHaveBeenCalledWith({
      driverId: DRIVER,
      gap: { started_on: expect.stringMatching(/^2025-0[23]-/), ended_on: expect.stringMatching(/^2025-0[56]-/), explanation: "Cared for a parent" },
    });
  });

  it("shows the applicant's words and the office's beside the gap they overlap, and who added it after signing", async () => {
    gapsView.value = { recorded: [RECORDED()], applicant: [{ from: "2025-03-02", to: "2025-05-30", explanation: "Moved house" }] };
    const w = section();
    await flushPromises();
    const box = w.get("[data-record-gap]");
    expect(box.get("[data-gap-applicant]").text()).toBe("The applicant said: Moved house");
    expect(box.get("[data-gap-recorded]").text()).toContain("Added by Dana on 11/01/2026, after signing");
    expect(box.text()).not.toContain("Not explained yet.");
    expect(w.find("[data-unplaced-gaps]").exists()).toBe(false);
  });

  it("keeps a recorded gap that no longer meets a drawn one, below the timeline, never dropped", async () => {
    gapsView.value = { recorded: [RECORDED({ startedOn: "2020-01-01", endedOn: "2020-02-01", explanation: "Old gap" })], applicant: [] };
    const w = section();
    await flushPromises();
    expect(w.get("[data-unplaced-gaps]").text()).toContain("Old gap");
  });

  it("withdraws the office's explanation only after asking", async () => {
    gapsView.value = { recorded: [RECORDED()], applicant: [] };
    const w = section();
    await flushPromises();
    await w.get("[data-record-gap]").findAll("button").find((b) => b.text() === "Withdraw")!.trigger("click");
    await flushPromises();
    useConfirmStore().answer(false);
    await flushPromises();
    expect(gapMutations.withdraw).not.toHaveBeenCalled();
    await w.get("[data-record-gap]").findAll("button").find((b) => b.text() === "Withdraw")!.trigger("click");
    await flushPromises();
    useConfirmStore().answer(true);
    await flushPromises();
    expect(gapMutations.withdraw).toHaveBeenCalledWith({ driverId: DRIVER, gapId: "g1" });
    w.unmount();
  });

  it("shows a withdrawn explanation struck through, and does not count it as explaining the gap", async () => {
    gapsView.value = { recorded: [RECORDED({ withdrawnAt: "2026-11-01T12:00:00Z" })], applicant: [] };
    const w = section();
    await flushPromises();
    const box = w.get("[data-record-gap]");
    expect(box.get("[data-gap-recorded] p").classes()).toContain("line-through");
    expect(box.text()).toContain("Not explained yet.");
    expect(box.findAll("button").some((b) => b.text() === "Withdraw")).toBe(false);
  });
});
