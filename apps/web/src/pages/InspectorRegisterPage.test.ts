import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { mount } from "@vue/test-utils";

/**
 * The inspector register (B3, closes §6 Q8).
 *
 * This page exists so that a derived legal assertion is visible to the people relying on it: the
 * printed report says the inspector meets the federal standard, and the product decides that from a
 * row here rather than from a tick box. A register nobody can see is not a source anybody can check.
 */

const state = vi.hoisted(() => ({
  inspectors: { value: [] as unknown[] },
  setPeriod: { mutate: vi.fn(), isPending: { value: false } },
  create: { mutateAsync: vi.fn(), isPending: { value: false } },
}));

vi.mock("@/features/maintenance/useAnnualInspections", () => ({
  useInspectorsQuery: () => ({
    data: state.inspectors,
    isLoading: ref(false),
    isFetching: ref(false),
    isError: ref(false),
    error: ref(null),
    refetch: vi.fn(),
  }),
  useSetInspectorPeriod: () => state.setPeriod,
  useCreateInspector: () => state.create,
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true }) }));

const InspectorRegisterPage = (await import("@/pages/InspectorRegisterPage.vue")).default;

const inspector = (over: Record<string, unknown> = {}) => ({
  id: "i-1",
  full_name: "George Gacev",
  qualification_basis: "training_and_experience",
  brake_qualified: true,
  effective_from: "2024-01-01",
  effective_to: null,
  qualified: true,
  ...over,
});

const page = (rows: unknown[]) => {
  state.inspectors.value = rows;
  return mount(InspectorRegisterPage, { global: { stubs: { PageHeader: true, NewInspectorModal: true } } });
};

describe("what the register shows", () => {
  it("names the qualification in plain words, not as a citation (D-AVI15)", () => {
    const text = page([inspector()]).text();
    expect(text).toContain("Training and experience");
    expect(text).not.toContain("§");
    expect(text).not.toContain("396.19");
  });

  it("says whether the brake qualification is held — thirteen of the parts depend on it", () => {
    expect(page([inspector({ brake_qualified: true })]).text()).toContain("Yes");
    expect(page([inspector({ brake_qualified: false })]).text()).toContain("No");
  });

  it("shows an open period as 'Since', and a closed one as a range", () => {
    expect(page([inspector()]).text()).toContain("Since 2024-01-01");
    const retired = page([inspector({ effective_to: "2026-01-31", qualified: false })]).text();
    expect(retired).toContain("2024-01-01 — 2026-01-31");
    expect(retired).toContain("Retired");
  });

  it("warns when nobody is on it, because no inspection can be started", () => {
    expect(page([]).text()).toContain("Nobody is on the register yet");
  });
});

describe("retiring somebody is a date, never a delete", () => {
  it("closes the period rather than removing the row", () => {
    const w = page([inspector()]);
    const button = w.findAll("button").find((b) => b.text() === "Retire")!;
    void button.trigger("click");
    // A report has to name who performed it, and the qualification evidence outlives the employment
    // — so the only thing that ends is their availability for a NEW inspection.
    expect(state.setPeriod.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "i-1", effectiveTo: expect.any(String) }),
    );
  });

  it("offers to bring a retired inspector back", () => {
    const w = page([inspector({ qualified: false, effective_to: "2026-01-31" })]);
    const button = w.findAll("button").find((b) => b.text() === "Reinstate")!;
    void button.trigger("click");
    expect(state.setPeriod.mutate).toHaveBeenCalledWith({ id: "i-1", effectiveTo: null });
  });
});
