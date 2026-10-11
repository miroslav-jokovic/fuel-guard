import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { computed, ref } from "vue";
import type { FuelException } from "./useExceptions";

/**
 * The money finding's drawer, since its moves became buttons (F02-F04 8c4 follow-up). The plan's accept
 * is "closing an item takes ≤ 3 clicks", counted from the queue's row (ruled 2026-10-08): the row is one,
 * so a close here must be one click, and a credit two (Credited, then Save credit) with the amount typed.
 */
const state = { ex: null as FuelException | null, calls: [] as unknown[] };
vi.mock("./useExceptions", () => ({
  useExceptionQuery: () => ({ data: computed(() => (state.ex ? { exception: state.ex, events: [] } : null)), isLoading: ref(false) }),
  useMoveException: () => ({ mutateAsync: async (v: unknown) => { state.calls.push(v); }, isPending: ref(false) }),
}));
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("admin");
  return { useSessionStore: () => s, __session: s };
});
const { __session: session } = (await import("@/stores/session")) as unknown as {
  __session: import("@/testing/fakeSession").FakeSession;
};
import ExceptionSlideOver from "./ExceptionSlideOver.vue";

const finding = (o: Partial<FuelException> = {}) =>
  ({ id: "e1", kind: "contract_variance", status: "open", amount: 41.2, amount_kind: "recoverable", occurred_on: "2026-10-06",
    unit_number: "555", evidence: {}, first_seen_at: "2026-10-06T12:00:00Z", credited_amount: null, ...o }) as unknown as FuelException;
const button = (text: string) => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
const click = async (text: string) => { button(text)!.click(); await flushPromises(); };

beforeEach(() => {
  setActivePinia(createPinia());
  document.body.innerHTML = "";
  state.ex = finding();
  state.calls = [];
  session.role = "admin";
});
const mountDrawer = async () => {
  const w = mount(ExceptionSlideOver, { props: { id: "e1" }, attachTo: document.body });
  await flushPromises();
  return w;
};

describe("closing a money finding", () => {
  it("dismisses in one click inside the drawer", async () => {
    await mountDrawer();
    await click("Dismissed");
    expect(state.calls).toEqual([{ id: "e1", status: "dismissed", note: undefined, creditedAmount: undefined }]);
  });

  it("credits in two clicks, with the amount typed rather than defaulted", async () => {
    await mountDrawer();
    await click("Credited");
    expect(state.calls).toHaveLength(0);
    expect(button("Save credit")!.disabled).toBe(true);
    const amount = document.body.querySelector<HTMLInputElement>('input[type="number"]')!;
    amount.value = "38.5";
    amount.dispatchEvent(new Event("input"));
    await flushPromises();
    await click("Save credit");
    expect(state.calls).toEqual([{ id: "e1", status: "credited", note: undefined, creditedAmount: 38.5 }]);
  });

  it("offers no move to the status it already has", async () => {
    state.ex = finding({ status: "disputed" });
    await mountDrawer();
    expect(button("Disputed")).toBeUndefined();
    expect(button("Dismissed")).toBeDefined();
  });

  // The PATCH route is `fuel: manage`; a dispatcher reads the ledger and does not move it.
  it("shows no moves to a role that cannot manage fuel", async () => {
    session.role = "dispatcher";
    await mountDrawer();
    expect(button("Dismissed")).toBeUndefined();
    expect(document.body.textContent).toContain("Paid above Pilot");
  });
});
