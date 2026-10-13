import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";

/** D-US6 — the two coverage summaries are FactLists; zero gaps reads "None", an answer and not a blank. */
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("admin");
  return { useSessionStore: () => s };
});
vi.mock("@/composables/useDrivers", () => ({ useDriverQuery: () => ({ data: ref({ hire_date: "2026-01-15" }) }) }));
const mutation = () => ({ mutateAsync: vi.fn(), isPending: ref(false) });
vi.mock("@/features/recruitment/useEmployment", () => ({
  useEmploymentHistoryQuery: () => ({
    data: ref([]), isLoading: ref(false), isError: ref(false), error: ref(null), isFetching: ref(false),
  }),
  useAddEmployment: mutation, useUpdateEmployment: mutation, useRemoveEmployment: mutation,
}));
const EmploymentHistorySection = (await import("./EmploymentHistorySection.vue")).default;

beforeEach(() => setActivePinia(createPinia()));

describe("the employment coverage summaries", () => {
  it("pairs each count with its label in both lists", () => {
    const w = mount(EmploymentHistorySection, {
      props: { driverId: "d1" },
      global: { stubs: { DataTable: true, SlideOver: true, EmploymentForm: true } },
    });
    const [all, cmv] = w.findAll("dl");
    expect(all!.findAll("dt").map((d) => d.text())).toEqual(["Employers", "Gaps", "Inquiries due"]);
    expect(all!.findAll("dd").map((d) => d.text())[0]).toBe("0");
    expect(all!.findAll("dd").map((d) => d.text())[2]).toBe("None");
    expect(cmv!.findAll("dt").map((d) => d.text())).toEqual(["CMV employers", "Other listed"]);
    expect(cmv!.findAll("dd").map((d) => d.text())).toEqual(["0", "0"]);
  });
});
