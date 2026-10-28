import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { useToastStore } from "@/stores/toast";
import { answerConfirm } from "@silvicom/ui/testing";

/**
 * The inspector register (B3, closes §6 Q8).
 *
 * This page exists so that a derived legal assertion is visible to the people relying on it: the
 * printed report says the inspector meets the federal standard, and the product decides that from a
 * row here rather than from a tick box. A register nobody can see is not a source anybody can check.
 */

const state = vi.hoisted(() => ({
  inspectors: { value: [] as unknown[] | undefined },
  failed: false,
  setPeriod: { mutateAsync: vi.fn(async () => undefined), isPending: { value: false } },
  create: { mutateAsync: vi.fn(), isPending: { value: false } },
  remove: { mutateAsync: vi.fn(async () => undefined), isPending: { value: false } },
}));

vi.mock("@/features/maintenance/useAnnualInspections", () => ({
  useInspectorsQuery: () => ({
    data: state.inspectors,
    isLoading: ref(false),
    isFetching: ref(false),
    isError: ref(state.failed),
    error: ref(null),
    refetch: vi.fn(),
  }),
  useSetInspectorPeriod: () => state.setPeriod,
  useCreateInspector: () => state.create,
  useDeleteInspector: () => state.remove,
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

// A real memory router per mount: the register keeps its filters in the URL since D-US2.
const newRouter = (): Router =>
  createRouter({ history: createMemoryHistory(), routes: [{ path: "/:any(.*)*", component: { template: "<div/>" } }] });

const page = (rows: unknown[], router: Router = newRouter()) => {
  state.inspectors.value = rows;
  return mount(InspectorRegisterPage, {
    attachTo: document.body,
    global: { plugins: [router], stubs: { PageHeader: true, InspectorDrawer: true } },
  });
};

/**
 * Row actions live behind the ⋮ (contract §5.6), so every one of them is two clicks.
 *
 * The panel is TELEPORTED to `<body>` — that is how `KebabMenu` escapes the table's overflow — so it
 * is not inside the wrapper and `w.findAll` cannot see it. Stubbing the teleport to bring it back in
 * is not an option either: the stub renders the panel in place while `useFloating`'s `autoUpdate`
 * keeps measuring it, and Vue aborts with "maximum recursive updates". So the query is on the real
 * document, which is also where a user's click lands.
 */
async function click(w: ReturnType<typeof page>, label: string) {
  (w.element.querySelector('button[aria-label="Actions"]') as HTMLButtonElement).click();
  await nextTick();
  const item = Array.from(document.body.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label,
  );
  expect(item, `no row action labelled "${label}"`).toBeTruthy();
  item!.click();
  await nextTick();
}

beforeEach(() => {
  document.body.innerHTML = "";
  setActivePinia(createPinia());
  state.setPeriod.mutateAsync.mockClear();
  state.remove.mutateAsync.mockClear();
  vi.restoreAllMocks();
  state.failed = false;
});

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
    // MM/DD/YYYY since US6b F27: this pinned the raw ISO the register printed (D-DS18).
    expect(page([inspector()]).text()).toContain("Since 01/01/2024");
    const retired = page([inspector({ effective_to: "2026-01-31", qualified: false })]).text();
    expect(retired).toContain("01/01/2024 → 01/31/2026");
    expect(retired).toContain("Off the list");
  });

  // F6 (US6b): a failed read has no rows either, and is not an empty register.
  it("does not say nobody is on it when the register could not be read", () => {
    state.failed = true;
    const t = page([]).text();
    expect(t).toContain("Could not load the register.");
    expect(t).not.toContain("Nobody is on the register yet");
  });

  it("warns when nobody is on it, because no inspection can be started", () => {
    expect(page([]).text()).toContain("Nobody is on the register yet");
  });
});

describe("retiring somebody is a date, not a deletion", () => {
  it("closes the period rather than removing the row", async () => {
    const w = page([inspector()]);
    await click(w, "Take off the list");
    // A report has to name who performed it, and the qualification evidence outlives the employment
    // — so the only thing that ends is their availability for a NEW inspection.
    expect(state.setPeriod.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: "i-1", effectiveTo: expect.any(String) }),
    );
    expect(state.remove.mutateAsync).not.toHaveBeenCalled();
  });

  it("offers to bring a retired inspector back", async () => {
    const w = page([inspector({ qualified: false, effective_to: "2026-01-31" })]);
    await click(w, "Put back on the list");
    expect(state.setPeriod.mutateAsync).toHaveBeenCalledWith({ id: "i-1", effectiveTo: null });
  });
});

describe("removing a row that was never used", () => {
  it("asks first, and does nothing when the answer is no", async () => {
    const asked = answerConfirm(false);
    const w = page([inspector()]);
    await click(w, "Delete");
    await flushPromises();
    // D-US7: the product's dialog, the person named in the question, the verb on a red button.
    expect(asked).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Delete George Gacev from the list?", confirmLabel: "Delete", tone: "danger" }),
    );
    expect(state.remove.mutateAsync).not.toHaveBeenCalled();
  });

  it("removes the row once it is confirmed", async () => {
    answerConfirm(true);
    const w = page([inspector()]);
    await click(w, "Delete");
    await flushPromises();
    expect(state.remove.mutateAsync).toHaveBeenCalledWith("i-1");
  });

  it("shows the API's refusal, which is what sends the reader to Retire instead", async () => {
    // The boundary is 0280's `on delete restrict`, not this page — so the page must not paraphrase
    // the refusal, it must show it. A carrier who tries to delete their only inspector needs the
    // sentence that names the alternative.
    answerConfirm(true);
    state.remove.mutateAsync.mockRejectedValueOnce(
      new Error("This person has performed inspections, so their record has to stay on file. Retire them instead."),
    );
    const w = page([inspector()]);
    await click(w, "Delete");
    await new Promise((r) => setTimeout(r, 0));

    const toasts = useToastStore().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.variant).toBe("error");
    expect(toasts[0]!.message).toContain("Retire them instead");
  });
});

describe("clearing the filters", () => {
  /** "Active only" is where the register opens, so clearing returns there rather than to an empty value. */
  it("offers Clear filters once retired inspectors are shown, and clearing goes back to active only", async () => {
    const FilterSelect = (await import("@/components/ui/FilterSelect.vue")).default;
    const w = page([inspector()]);
    const show = () => w.findAllComponents(FilterSelect).find((c) => c.props("label") === "Show")!;
    const clearFilters = () => w.findAll("button").find((b) => b.text() === "Clear filters");
    expect(clearFilters()).toBeUndefined();
    show().vm.$emit("update:modelValue", "all");
    await nextTick();
    await clearFilters()!.trigger("click");
    expect(show().props("modelValue")).toBe("active");
    expect(clearFilters()).toBeUndefined();
  });
});

/**
 * D-US2 (UI-STANDARDIZATION, 2026-10-12) — the register keeps its filters in the URL, so a reload or
 * Back keeps them. "Active only" is where it opens, and stays out of the URL.
 */
describe("the register keeps its filters in the URL", () => {
  async function at(url: string) {
    const router = newRouter();
    await router.push(url);
    await router.isReady();
    const w = page(
      [inspector(), inspector({ id: "i-2", full_name: "Ruth State", qualification_basis: "state_federal_program" })],
      router,
    );
    await flushPromises();
    return { w, query: () => router.currentRoute.value.query };
  }
  const select = async (w: ReturnType<typeof page>, label: string) => {
    const FilterSelect = (await import("@/components/ui/FilterSelect.vue")).default;
    return w.findAllComponents(FilterSelect).find((c) => c.props("label") === label)!;
  };

  it("reads the basis, the search and Including retired back from a pasted link", async () => {
    const { w } = await at("/maintenance/inspectors?basis=state_federal_program&retired=1");
    expect((await select(w, "Trained as")).props("modelValue")).toBe("state_federal_program");
    expect((await select(w, "Show")).props("modelValue")).toBe("all");
    expect(w.text()).toContain("Ruth State");
    expect(w.text()).not.toContain("George Gacev");
  });

  it("writes a control change to the URL", async () => {
    const { w, query } = await at("/maintenance/inspectors");
    (await select(w, "Show")).vm.$emit("update:modelValue", "all");
    (await select(w, "Trained as")).vm.$emit("update:modelValue", "training_and_experience");
    await flushPromises();
    expect(query()).toEqual({ retired: "1", basis: "training_and_experience" });
  });

  it("Clear filters puts every filter back where the register opens", async () => {
    const { w, query } = await at("/maintenance/inspectors?basis=state_federal_program&retired=1&search=ru");
    w.findComponent({ name: "FilterBar" }).vm.$emit("clear-all");
    await flushPromises();
    expect(query()).toEqual({});
  });

  it("reads a basis outside the contract's list as Any", async () => {
    const { w } = await at("/maintenance/inspectors?basis=grandfathered");
    expect((await select(w, "Trained as")).props("modelValue")).toBe("");
    expect(w.text()).toContain("Ruth State");
    expect(w.text()).toContain("George Gacev");
  });
});

/** D-US8: the register pages twenty at a time, the page in the URL beside its filters (D-US2). */
describe("the register pages", () => {
  const many = Array.from({ length: 45 }, (_, i) =>
    inspector({ id: `i-${i + 1}`, full_name: `Inspector ${String(i + 1).padStart(2, "0")}` }),
  );
  async function at(url: string) {
    const router = newRouter();
    await router.push(url);
    await router.isReady();
    const w = page(many, router);
    await flushPromises();
    return { w, query: () => router.currentRoute.value.query };
  }

  it("a pasted ?page=2 shows inspectors 21–40", async () => {
    const { w } = await at("/maintenance/inspectors?page=2");
    const text = w.text();
    expect(text).toContain("Inspector 21");
    expect(text).toContain("Inspector 40");
    expect(text).not.toContain("Inspector 20");
    expect(text).not.toContain("Inspector 41");
  });

  it("a filter change returns to page 1", async () => {
    const { w, query } = await at("/maintenance/inspectors?page=2");
    const FilterSelect = (await import("@/components/ui/FilterSelect.vue")).default;
    w.findAllComponents(FilterSelect).find((c) => c.props("label") === "Show")!.vm.$emit("update:modelValue", "all");
    await flushPromises();
    expect(query()).toEqual({ retired: "1" });
    expect(w.text()).toContain("Inspector 01");
  });
});
