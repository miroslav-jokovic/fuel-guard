import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { useToastStore } from "@/stores/toast";

/**
 * The inspector register (B3, closes §6 Q8).
 *
 * This page exists so that a derived legal assertion is visible to the people relying on it: the
 * printed report says the inspector meets the federal standard, and the product decides that from a
 * row here rather than from a tick box. A register nobody can see is not a source anybody can check.
 */

const state = vi.hoisted(() => ({
  inspectors: { value: [] as unknown[] },
  setPeriod: { mutateAsync: vi.fn(async () => undefined), isPending: { value: false } },
  create: { mutateAsync: vi.fn(), isPending: { value: false } },
  remove: { mutateAsync: vi.fn(async () => undefined), isPending: { value: false } },
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

const page = (rows: unknown[]) => {
  state.inspectors.value = rows;
  return mount(InspectorRegisterPage, {
    attachTo: document.body,
    global: { stubs: { PageHeader: true, InspectorDrawer: true } },
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
    expect(page([inspector()]).text()).toContain("Since 2024-01-01");
    const retired = page([inspector({ effective_to: "2026-01-31", qualified: false })]).text();
    expect(retired).toContain("2024-01-01 — 2026-01-31");
    expect(retired).toContain("Retired");
  });

  it("warns when nobody is on it, because no inspection can be started", () => {
    expect(page([]).text()).toContain("Nobody is on the register yet");
  });
});

describe("retiring somebody is a date, not a deletion", () => {
  it("closes the period rather than removing the row", async () => {
    const w = page([inspector()]);
    await click(w, "Retire");
    // A report has to name who performed it, and the qualification evidence outlives the employment
    // — so the only thing that ends is their availability for a NEW inspection.
    expect(state.setPeriod.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: "i-1", effectiveTo: expect.any(String) }),
    );
    expect(state.remove.mutateAsync).not.toHaveBeenCalled();
  });

  it("offers to bring a retired inspector back", async () => {
    const w = page([inspector({ qualified: false, effective_to: "2026-01-31" })]);
    await click(w, "Reinstate");
    expect(state.setPeriod.mutateAsync).toHaveBeenCalledWith({ id: "i-1", effectiveTo: null });
  });
});

describe("removing a row that was never used", () => {
  it("asks first, and does nothing when the answer is no", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const w = page([inspector()]);
    await click(w, "Remove from register");
    expect(state.remove.mutateAsync).not.toHaveBeenCalled();
  });

  it("removes the row once it is confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const w = page([inspector()]);
    await click(w, "Remove from register");
    expect(state.remove.mutateAsync).toHaveBeenCalledWith("i-1");
  });

  it("shows the API's refusal, which is what sends the reader to Retire instead", async () => {
    // The boundary is 0280's `on delete restrict`, not this page — so the page must not paraphrase
    // the refusal, it must show it. A carrier who tries to delete their only inspector needs the
    // sentence that names the alternative.
    vi.spyOn(window, "confirm").mockReturnValue(true);
    state.remove.mutateAsync.mockRejectedValueOnce(
      new Error("This person has performed inspections, so their record has to stay on file. Retire them instead."),
    );
    const w = page([inspector()]);
    await click(w, "Remove from register");
    await new Promise((r) => setTimeout(r, 0));

    const toasts = useToastStore().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.variant).toBe("error");
    expect(toasts[0]!.message).toContain("Retire them instead");
  });
});
