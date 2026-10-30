import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises } from "@vue/test-utils";

/**
 * The tab that holds the office scanner (SCANNER-RELAY-PLAN.md SR4). What is pinned:
 *
 *   · taking a free scanner starts the wait; one somebody else holds is answered with their name and
 *     changes nothing until forced;
 *   · every read goes to the page's scan listeners, in order, and the cursor moves past it;
 *   · with no scan screen open a read is shown, never dropped silently;
 *   · somebody else taking it, or its retirement, ends the wait and says so;
 *   · a dropped connection is retried, not given up on;
 *   · "Stop using" frees the lease at once, and a reload of the same tab resumes the scanner.
 */

const api = vi.hoisted(() => ({
  take: vi.fn(),
  release: vi.fn(async () => ({ ok: true })),
  wait: vi.fn(),
}));
const deliver = vi.hoisted(() => ({ deliverRelayedScan: vi.fn((_code: string) => true) }));
const toast = vi.hoisted(() => ({ info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock("@/composables/useScanners", () => ({ scannerApi: api }));
vi.mock("@/composables/useScanInput", () => deliver);
vi.mock("@/stores/toast", () => ({ useToastStore: () => toast }));

const { useScannerRelayStore } = await import("./scannerRelay");

const DESK = { id: "55555555-5555-4555-8555-555555555555", name: "Office scanner" };

/** A wait that answers once with `answer`, then hangs until the test ends (like an idle long poll). */
function waits(...answers: unknown[]) {
  const queue = [...answers];
  api.wait.mockImplementation(async () => {
    const next = queue.shift();
    if (next === undefined) return new Promise(() => {});
    if (next instanceof Error) throw next;
    return next;
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  sessionStorage.clear();
  vi.clearAllMocks();
  deliver.deliverRelayedScan.mockReturnValue(true);
});
afterEach(() => vi.useRealTimers());

describe("taking the scanner", () => {
  it("a free scanner is taken for this tab, and its reads go to the page in order", async () => {
    api.take.mockResolvedValue({ outcome: "taken", holderName: "Mia Office", heldUntil: "x" });
    waits({ held: true, holderName: null, reads: [{ id: 41, code: "SIL1:AST:7K3M9P", readAt: "t" }, { id: 42, code: "012345678905", readAt: "t" }] });
    const relay = useScannerRelayStore();
    expect(await relay.take(DESK)).toEqual({ ok: true });
    await flushPromises();
    expect(api.take).toHaveBeenCalledWith(DESK.id, relay.session, false);
    expect(deliver.deliverRelayedScan.mock.calls.map((c) => c[0])).toEqual(["SIL1:AST:7K3M9P", "012345678905"]);
    expect(api.wait).toHaveBeenLastCalledWith(DESK.id, relay.session, 42);
    expect(relay.held).toEqual(DESK);
    expect(relay.lastRead).toMatchObject({ code: "012345678905", used: true });
  });

  it("held by somebody else: their name, and nothing changes", async () => {
    api.take.mockResolvedValue({ outcome: "held", holderName: "Tom Tech", heldUntil: "x" });
    const relay = useScannerRelayStore();
    expect(await relay.take(DESK)).toEqual({ ok: false, heldBy: "Tom Tech" });
    expect(relay.held).toBeNull();
    expect(api.wait).not.toHaveBeenCalled();
  });

  it("a read with no scan screen open is shown, not dropped", async () => {
    deliver.deliverRelayedScan.mockReturnValue(false);
    api.take.mockResolvedValue({ outcome: "taken", holderName: "Mia", heldUntil: "x" });
    waits({ held: true, holderName: null, reads: [{ id: 1, code: "SIL1:AST:7K3M9P", readAt: "t" }] });
    const relay = useScannerRelayStore();
    await relay.take(DESK);
    await flushPromises();
    expect(toast.info).toHaveBeenCalledWith("Scanned SIL1:AST:7K3M9P", expect.stringContaining("Open Scan"));
    expect(relay.lastRead?.used).toBe(false);
  });

  it("taking a second scanner lets the first go", async () => {
    api.take.mockResolvedValue({ outcome: "taken", holderName: "Mia", heldUntil: "x" });
    waits();
    const relay = useScannerRelayStore();
    await relay.take(DESK);
    await relay.take({ id: "66666666-6666-4666-8666-666666666666", name: "Shop scanner" });
    expect(api.release).toHaveBeenCalledWith(DESK.id, relay.session);
    expect(relay.held?.name).toBe("Shop scanner");
  });
});

describe("losing it", () => {
  it("somebody else taking it ends the wait and names them", async () => {
    api.take.mockResolvedValue({ outcome: "taken", holderName: "Mia", heldUntil: "x" });
    waits({ held: false, holderName: "Tom Tech", reads: [] });
    const relay = useScannerRelayStore();
    await relay.take(DESK);
    await flushPromises();
    expect(relay.held).toBeNull();
    expect(toast.warning).toHaveBeenCalledWith("Tom Tech is using Office scanner now", expect.any(String));
    expect(api.wait).toHaveBeenCalledTimes(1);
  });

  it("a retired scanner (404) ends the wait", async () => {
    api.take.mockResolvedValue({ outcome: "taken", holderName: "Mia", heldUntil: "x" });
    waits(Object.assign(new Error("gone"), { status: 404 }));
    const relay = useScannerRelayStore();
    await relay.take(DESK);
    await flushPromises();
    expect(relay.held).toBeNull();
    expect(toast.warning).toHaveBeenCalledWith("Office scanner was removed", expect.any(String));
  });

  it("a dropped connection is retried, and says it is reconnecting meanwhile", async () => {
    vi.useFakeTimers();
    api.take.mockResolvedValue({ outcome: "taken", holderName: "Mia", heldUntil: "x" });
    waits(new Error("Failed to fetch"), { held: true, holderName: null, reads: [{ id: 9, code: "AFTER1", readAt: "t" }] });
    const relay = useScannerRelayStore();
    await relay.take(DESK);
    await vi.advanceTimersByTimeAsync(0);
    expect(relay.reconnecting).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(relay.reconnecting).toBe(false);
    expect(deliver.deliverRelayedScan).toHaveBeenCalledWith("AFTER1");
    expect(relay.held).toEqual(DESK);
  });
});

describe("stopping and resuming", () => {
  it("Stop using frees the lease at once and stops delivering", async () => {
    api.take.mockResolvedValue({ outcome: "taken", holderName: "Mia", heldUntil: "x" });
    let answer: (v: unknown) => void = () => {};
    api.wait.mockImplementation(() => new Promise((r) => (answer = r)));
    const relay = useScannerRelayStore();
    await relay.take(DESK);
    await relay.release();
    expect(api.release).toHaveBeenCalledWith(DESK.id, relay.session);
    answer({ held: true, holderName: null, reads: [{ id: 3, code: "LATE01", readAt: "t" }] });
    await flushPromises();
    expect(deliver.deliverRelayedScan).not.toHaveBeenCalled();
    expect(relay.held).toBeNull();
  });

  it("a reload of the same tab resumes the scanner it held, with the same tab id", async () => {
    api.take.mockResolvedValue({ outcome: "taken", holderName: "Mia", heldUntil: "x" });
    waits();
    const first = useScannerRelayStore();
    await first.take(DESK);
    const session = first.session;

    setActivePinia(createPinia());
    waits();
    const reloaded = useScannerRelayStore();
    reloaded.resume();
    await flushPromises();
    expect(reloaded.session).toBe(session);
    expect(reloaded.held).toEqual(DESK);
    expect(api.wait).toHaveBeenLastCalledWith(DESK.id, session, 0);
  });
});
