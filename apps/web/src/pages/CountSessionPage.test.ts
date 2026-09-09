import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

/**
 * The shelf walk (INVENTORY-PLAN.md I5 PR 2b).
 *
 * ── THE FOUR THINGS THIS SCREEN CAN GET WRONG THAT NOTHING ELSE WOULD CATCH ───────────────────
 *
 *   1. **The count is written to the phone BEFORE the network is touched.** That ordering is the
 *      whole feature — the strip promises the count is safe, and a screen that sent first and
 *      remembered afterwards would lose the last four bins when somebody walks behind a container.
 *      A test that only checked "it eventually sent" would pass against exactly that screen.
 *   2. **`blind` is recorded per MOVEMENT, from the mode in force when the number was typed.** Not
 *      from the session, which records only how the walk started: a supervisor may reveal part-way,
 *      and "could this counter see the answer" is a per-row fact after that.
 *   3. **D-INV21's ladder is asked, and a refused confirm records nothing.** A confirm the
 *      technician cancels must leave the shelf and the queue untouched.
 *   4. **An uncounted line is not a zero.** It is uncounted in the review and closing leaves it
 *      alone; writing a zero would be a shortage the shop never observed.
 */

const ORG_LINE = (over: Record<string, unknown> = {}) => ({
  partId: "11111111-1111-4111-8111-111111111111",
  locationId: "22222222-2222-4222-8222-222222222222",
  partNumber: "LF9080",
  partDescription: "Oil filter",
  locationName: "Main shop",
  unitOfMeasure: "each",
  quantityOnHand: 12,
  reorderPoint: 3,
  reorderQuantity: 24,
  tagCode: null,
  lastCost: 21.4,
  active: true,
  aisle: null,
  row: null,
  bin: null,
  ...over,
});

const SECOND_LINE = ORG_LINE({
  partId: "33333333-3333-4333-8333-333333333333",
  partNumber: "AF25550",
  partDescription: "Air filter",
  quantityOnHand: 4,
});

/** A real uuid: `countStockSchema.countSessionId` is `z.uuid()`, so a short stub is refused. */
const SESSION = "44444444-4444-4444-8444-444444444444";

const walk = ref<Record<string, unknown> | undefined>({
  id: SESSION,
  kind: "location",
  locationId: "22222222-2222-4222-8222-222222222222",
  vehicleId: null,
  trailerId: null,
  holderLabel: "Main shop",
  startedBy: "u-1",
  startedByName: "Shop Lead",
  blind: true,
  status: "open",
  openedAt: "2026-09-09T10:00:00.000Z",
  closedAt: null,
  note: null,
});
const lines = ref<Array<Record<string, unknown>>>([ORG_LINE(), SECOND_LINE]);

// Typed with its argument, so `mock.calls[0][0]` is the payload rather than a zero-length tuple.
const record = vi.hoisted(() => ({
  mutateAsync: vi.fn(async (_movement: Record<string, unknown>) => ({ id: "m" })),
  isPending: { value: false },
}));
const closeWalk = vi.hoisted(() => ({ mutateAsync: vi.fn(async () => ({})), isPending: { value: false } }));

vi.mock("@/features/inventory/useInventory", async () => {
  const { ref: r } = await import("vue");
  return {
    useCountSessionQuery: () => ({ data: walk, isLoading: r(false), isError: r(false) }),
    useStockQuery: () => ({ data: r({ lines: lines.value, total: lines.value.length }), isLoading: r(false) }),
    useRecordMovement: () => record,
    useCloseCountSession: () => closeWalk,
  };
});
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true }) }));
vi.mock("vue-router", () => ({
  useRoute: () => ({ params: { sessionId: SESSION } }),
  useRouter: () => ({ push: vi.fn() }),
}));

const { pending } = await import("@/features/inventory/countQueue");
const CountSessionPage = (await import("@/pages/CountSessionPage.vue")).default;

/** The bottom bar is a Teleport target the shop layout owns; the test has to supply one. */
function withBar() {
  const bar = document.createElement("div");
  bar.id = "shop-action-bar";
  document.body.appendChild(bar);
  return bar;
}

const page = () => mount(CountSessionPage, { attachTo: document.body, global: { stubs: { Teleport: true } } });
type W = ReturnType<typeof page>;

/**
 * ⚠ `flushPromises` is not enough on this screen, and the reason is the feature.
 *
 * Recording a count writes to IndexedDB before it touches the network, and IndexedDB delivers its
 * events as MACROTASKS — so a helper that only drains microtasks returns while the write is still in
 * flight, and every assertion after it reads a screen that has not caught up. The first version of
 * this file did exactly that and four assertions failed against correct code.
 */
const settle = async () => {
  // Several ticks, not one: recording a count is a CHAIN of IndexedDB round trips — put, then read,
  // then delete — and each one's event is its own macrotask. One tick returns halfway through.
  for (let i = 0; i < 5; i += 1) {
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await flushPromises();
};

const typeCount = async (w: W, value: string) => {
  await w.find("input").setValue(value);
  await settle();
};
const pressRecord = async (w: W) => {
  await w.findAll("button").find((b) => b.text() === "Record count")!.trigger("click");
  await settle();
};

beforeEach(() => {
  setActivePinia(createPinia());
  globalThis.indexedDB = new IDBFactory();
  // `mockReset` and not `mockClear`: a previous test's `mockRejectedValue` is an IMPLEMENTATION, and
  // clearing only the call log leaves it in place for the next test to trip over.
  record.mutateAsync.mockReset();
  record.mutateAsync.mockImplementation(async (_movement: Record<string, unknown>) => ({ id: "m" }));
  closeWalk.mutateAsync.mockReset();
  closeWalk.mutateAsync.mockImplementation(async () => ({}));
  lines.value = [ORG_LINE(), SECOND_LINE];
  walk.value = { ...(walk.value as object), blind: true, status: "open" };
  document.body.innerHTML = "";
  withBar();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("the order of operations", () => {
  /**
   * ⚠ THE ASSERTION THIS FILE EXISTS FOR, and its first version could not fail.
   *
   * That version made the send reject and checked the row was queued afterwards — which passes just
   * as well against a screen that sends FIRST and only writes the count down when the send fails.
   * The mutation proved it: moving the `enqueue` into the catch broke nothing. Both shapes look
   * identical from outside; they differ only in what survives a tab closing mid-request, which is
   * exactly the case the bay is full of.
   *
   * So the queue is observed AT THE MOMENT OF THE SEND, from inside the send itself. That is the
   * only vantage point from which "written down before the network was touched" is a statement about
   * anything.
   */
  it("has already written the count down by the time it tries to send it", async () => {
    let queuedWhenSent: number | null = null;
    record.mutateAsync.mockImplementation(async (_movement: Record<string, unknown>) => {
      queuedWhenSent = (await pending(SESSION)).length;
      return { id: "m" };
    });
    const w = page();
    await settle();
    await typeCount(w, "11");
    await pressRecord(w);
    expect(queuedWhenSent).toBe(1);
  });

  it("keeps the count on the phone when the send fails", async () => {
    record.mutateAsync.mockRejectedValue(new Error("offline"));
    const w = page();
    await settle();
    await typeCount(w, "11");
    await pressRecord(w);

    const queued = await pending(SESSION);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.movement).toMatchObject({ reason: "counted", countedTotal: 11 });
  });

  it("clears it from the phone once the server has it", async () => {
    const w = page();
    await settle();
    await typeCount(w, "11");
    await pressRecord(w);
    expect(await pending(SESSION)).toHaveLength(0);
  });

  it("says so on screen while anything is waiting", async () => {
    record.mutateAsync.mockRejectedValue(new Error("offline"));
    const w = page();
    await settle();
    await typeCount(w, "11");
    await pressRecord(w);
    expect(w.text()).toContain("Saving on this phone");
  });
});

describe("blind counting (D-INV20)", () => {
  it("hides the expected figure and records the movement as blind", async () => {
    const w = page();
    await settle();
    expect(w.text()).not.toContain("Expected 12");
    await typeCount(w, "12");
    await pressRecord(w);
    expect(record.mutateAsync.mock.calls[0]?.[0]).toMatchObject({ blind: true });
  });

  /**
   * The mode is per MOVEMENT, not per session. A supervisor revealing part-way means the rows before
   * and after are recorded differently — the session keeps saying how the walk STARTED.
   */
  it("records rows counted after a reveal as not blind", async () => {
    const w = page();
    await settle();
    await w.findAll("button").find((b) => b.text() === "Show expected")!.trigger("click");
    await settle();
    expect(w.text()).toContain("Expected 12");
    await typeCount(w, "12");
    await pressRecord(w);
    expect(record.mutateAsync.mock.calls[0]?.[0]).toMatchObject({ blind: false });
  });
});

describe("D-INV21's ladder", () => {
  it("does not stop a technician on a variance the rule forgives", async () => {
    const w = page();
    await settle();
    // 12 expected, 11 counted: a variance of one, under the floor of five. No question asked.
    await typeCount(w, "11");
    await pressRecord(w);
    expect(window.confirm).not.toHaveBeenCalled();
    expect(record.mutateAsync).toHaveBeenCalled();
  });

  it("asks before recording zero against a shelf that had something", async () => {
    const w = page();
    await settle();
    await typeCount(w, "0");
    await pressRecord(w);
    // The consequence, not "Are you sure".
    expect(vi.mocked(window.confirm).mock.calls[0]?.[0]).toContain("Record 0 of 12");
  });

  it("records NOTHING when the confirm is refused — not the ledger, not the phone", async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    const w = page();
    await settle();
    await typeCount(w, "0");
    await pressRecord(w);
    expect(record.mutateAsync).not.toHaveBeenCalled();
    expect(await pending(SESSION)).toHaveLength(0);
  });
});

describe("the review", () => {
  /**
   * ⚠ The bar offers "Review" while lines are still uncounted and "Review and close" once they are
   * all done. The first version of this page offered only the second, so the review was unreachable
   * until every line had a number — which makes "uncounted bins are a choice" not a choice at all,
   * and the way out of that is somebody typing zeros they never counted. These cases found it.
   */
  const openReview = async (w: W) => {
    const button = w.findAll("button").find((b) => b.text() === "Review" || b.text() === "Review and close");
    await button!.trigger("click");
    await settle();
  };

  it("buckets a short line, an over line and an untouched one", async () => {
    const w = page();
    await settle();
    await typeCount(w, "9"); // 12 expected → short 3
    await pressRecord(w);
    await typeCount(w, "6"); // 4 expected → over 2
    await pressRecord(w);
    await openReview(w);
    expect(w.text()).toContain("-3");
    expect(w.text()).toContain("+2");
  });

  /** An uncounted line is not a zero: it says so, and closing leaves it exactly as it was. */
  it("shows an uncounted line as uncounted rather than as a shortage", async () => {
    const w = page();
    await settle();
    await typeCount(w, "12");
    await pressRecord(w);
    await openReview(w);
    // One word: `AppBadge` capitalizes, so "Not counted" would RENDER as "Not Counted" — true in
    // the source and wrong on the screen. Found on a real render, not here.
    expect(w.text()).toContain("Uncounted");
  });

  it("names the uncounted lines in the closing confirm, so it is a choice", async () => {
    const w = page();
    await settle();
    await typeCount(w, "12");
    await pressRecord(w);
    await openReview(w);
    await w.findAll("button").find((b) => b.text() === "Close the count")!.trigger("click");
    await settle();
    const asked = String(vi.mocked(window.confirm).mock.calls.at(-1)?.[0] ?? "");
    expect(asked).toContain("not counted");
    expect(asked).toContain("cannot be undone");
    expect(closeWalk.mutateAsync).toHaveBeenCalled();
  });

  it("closes nothing when the confirm is refused", async () => {
    const w = page();
    await settle();
    await typeCount(w, "12");
    await pressRecord(w);
    await openReview(w);
    vi.mocked(window.confirm).mockReturnValue(false);
    await w.findAll("button").find((b) => b.text() === "Close the count")!.trigger("click");
    await settle();
    expect(closeWalk.mutateAsync).not.toHaveBeenCalled();
  });
});
