import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import type { CardCapabilities } from "@fuelguard/shared";
import CardControlDrawer from "./CardControlDrawer.vue";

/**
 * The drawer's job is to make a consequence impossible to reach by accident. These cases are about
 * what it REFUSES to do and what it must not misreport: no second write while one is in flight, no
 * cheerful toast for an outcome nobody confirmed, no idempotency key reused across a settled attempt,
 * and no draft or key carried from one card to another.
 */

const mutations = vi.hoisted(() => ({
  lock: { isPending: { value: false }, mutateAsync: vi.fn() },
  unlock: { isPending: { value: false }, mutateAsync: vi.fn() },
  grant: { isPending: { value: false }, mutateAsync: vi.fn() },
  clear: { isPending: { value: false }, mutateAsync: vi.fn() },
  prompts: { isPending: { value: false }, mutateAsync: vi.fn() },
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));

/** A COUNTER, not a constant: rotation is invisible to a mock that returns the same key every time,
 *  and rotation is precisely what the audit's idempotency finding is about. */
const keyGen = vi.hoisted(() => ({ n: 0, next: () => `key-${++keyGen.n}` }));

const FakeApiError = vi.hoisted(() =>
  class FakeApiError extends Error {
    constructor(message: string, public code: string, public status = 409, public detail: Record<string, unknown> = {}) {
      super(message);
    }
  },
);

vi.mock("./useCardControl", () => ({
  useLockCard: () => mutations.lock,
  useUnlockCard: () => mutations.unlock,
  useGrantOverride: () => mutations.grant,
  useClearOverride: () => mutations.clear,
  useSetPrompts: () => mutations.prompts,
  newIdempotencyKey: () => keyGen.next(),
  CardControlApiError: FakeApiError,
}));

vi.mock("@/stores/toast", () => ({ useToastStore: () => toast }));

vi.mock("@/components/SlideOver.vue", () => ({
  default: {
    props: ["open", "title", "description"],
    emits: ["close"],
    template: `<aside v-if="open"><h2>{{ title }}</h2><slot /><footer><slot name="footer" /></footer></aside>`,
  },
}));

vi.mock("@/components/StepUpPrompt.vue", () => ({
  default: {
    props: ["reason"],
    emits: ["confirmed", "cancel"],
    template: `<div data-testid="step-up" :data-reason="reason"><button data-testid="step-up-confirm" @click="$emit('confirmed')">Confirm</button></div>`,
  },
}));

const caps = (over: Partial<CardCapabilities> = {}): CardCapabilities => ({
  canLock: true, canUnlock: true, canOverride: true, canSetPrompts: true,
  writeEntitlement: "confirmed", blockedBy: null, ...over,
});

const wrappers: VueWrapper[] = [];

function render(over: Record<string, unknown> = {}) {
  const wrapper = mount(CardControlDrawer, {
    props: {
      open: true,
      cardId: "card-1",
      maskedRef: "••••3182",
      version: "0123456789abcdef0123456789abcdef",
      status: "Active",
      lastUsedDate: null,
      driverName: "Dana",
      unitPrompt: "3182",
      overrideUses: 0,
      overrideAllLocations: false,
      locationOverrideId: null,
      prompts: [{ infoId: "DRID", validationType: "EXACT_MATCH", matchValue: "D-4471" }],
      capabilities: caps(),
      ...over,
    },
  });
  wrappers.push(wrapper);
  return wrapper;
}

const button = (wrapper: VueWrapper, label: string) => {
  const match = wrapper.findAll("button").find((b) => b.text().trim() === label);
  if (!match) throw new Error(`Button not found: ${label}. Present: ${wrapper.findAll("button").map((b) => b.text().trim()).join(" | ")}`);
  return match;
};

/** Advance a lock to its confirmation and confirm it — the reason gate is gone (B1). */
async function lockAndConfirm(wrapper: VueWrapper) {
  await button(wrapper, "Lock card").trigger("click");
  await flushPromises();
  await button(wrapper, "Lock card").trigger("click");
  await flushPromises();
}

afterEach(() => {
  for (const w of wrappers.splice(0)) w.unmount();
  vi.clearAllMocks();
  keyGen.n = 0;
});

describe("no reason required (B1)", () => {
  it("dispatches a lock with no reason input on screen", async () => {
    mutations.lock.mutateAsync.mockResolvedValue({ status: "succeeded", mutationId: "m1" });
    const wrapper = render();
    expect(wrapper.findAll("input").some((i) => i.attributes("placeholder")?.includes("Truck"))).toBe(false);
    await lockAndConfirm(wrapper);
    expect(mutations.lock.mutateAsync).toHaveBeenCalledTimes(1);
    const arg = mutations.lock.mutateAsync.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.reason).toBeUndefined();
    expect(arg.expectedVersion).toBe("0123456789abcdef0123456789abcdef");
  });
});

describe("the confirmation replaces the body rather than stacking on it", () => {
  it("shows the confirmation and only then dispatches", async () => {
    mutations.lock.mutateAsync.mockResolvedValue({ status: "succeeded", mutationId: "m1" });
    const wrapper = render();
    await button(wrapper, "Lock card").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Lock this card?");
    expect(mutations.lock.mutateAsync).not.toHaveBeenCalled();
    await button(wrapper, "Lock card").trigger("click");
    await flushPromises();
    expect(mutations.lock.mutateAsync).toHaveBeenCalledTimes(1);
  });
});

describe("idempotency keys (audit P1-2)", () => {
  it("re-mints the key after a settled FAILED outcome, so a retry is a new request not a replay", async () => {
    mutations.lock.mutateAsync.mockResolvedValue({ status: "failed", mutationId: "m1", faultMessage: "nope" });
    const wrapper = render();
    await lockAndConfirm(wrapper);
    const firstKey = (mutations.lock.mutateAsync.mock.calls[0]![0] as { idempotencyKey: string }).idempotencyKey;

    // Drawer stayed open on failure; the operator tries again.
    await lockAndConfirm(wrapper);
    const secondKey = (mutations.lock.mutateAsync.mock.calls[1]![0] as { idempotencyKey: string }).idempotencyKey;
    expect(secondKey).not.toBe(firstKey);
  });

  it("KEEPS the key after a 'sent' outcome — a re-click must replay, never risk a second apply", async () => {
    mutations.lock.mutateAsync.mockResolvedValue({ status: "sent", mutationId: "m1" });
    const wrapper = render();
    await lockAndConfirm(wrapper);
    const firstKey = (mutations.lock.mutateAsync.mock.calls[0]![0] as { idempotencyKey: string }).idempotencyKey;
    await lockAndConfirm(wrapper);
    const secondKey = (mutations.lock.mutateAsync.mock.calls[1]![0] as { idempotencyKey: string }).idempotencyKey;
    expect(secondKey).toBe(firstKey);
  });

  it("re-seeds keys and drafts when the CARD changes under an open drawer (web finding #2)", async () => {
    mutations.lock.mutateAsync.mockResolvedValue({ status: "sent", mutationId: "m1" });
    const wrapper = render();
    await lockAndConfirm(wrapper);
    const cardAKey = (mutations.lock.mutateAsync.mock.calls[0]![0] as { idempotencyKey: string }).idempotencyKey;

    await wrapper.setProps({ cardId: "card-2", version: "ffffffffffffffffffffffffffffffff" });
    await flushPromises();
    await lockAndConfirm(wrapper);
    const call = mutations.lock.mutateAsync.mock.calls[1]![0] as { idempotencyKey: string; cardId: string; expectedVersion: string };
    expect(call.cardId).toBe("card-2");
    expect(call.expectedVersion).toBe("ffffffffffffffffffffffffffffffff");
    expect(call.idempotencyKey).not.toBe(cardAKey); // card B never inherits card A's key
  });
});

describe("outcomes an operator must not misread", () => {
  it("does not report an unverified write as success", async () => {
    mutations.lock.mutateAsync.mockResolvedValue({ status: "sent", mutationId: "m1" });
    const wrapper = render();
    await lockAndConfirm(wrapper);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith("Sent, but not confirmed", expect.stringContaining("WEX portal"));
    expect(wrapper.emitted("close")).toBeUndefined();
  });

  it("calls out an idempotent replay as matching an earlier attempt", async () => {
    mutations.lock.mutateAsync.mockResolvedValue({ status: "succeeded", mutationId: "m1", idempotent: true });
    const wrapper = render();
    await lockAndConfirm(wrapper);
    expect(toast.success).toHaveBeenCalledWith("Already done", expect.stringContaining("earlier attempt"));
  });

  it("gives a 409 its own handling and asks the page to refetch", async () => {
    mutations.lock.mutateAsync.mockRejectedValue(new FakeApiError("changed", "card_state_changed"));
    const wrapper = render();
    await lockAndConfirm(wrapper);
    expect(toast.error).toHaveBeenCalledWith("Card changed in EFS", expect.stringContaining("current settings"));
    expect(wrapper.emitted("changed")).toBeTruthy();
  });

  it("surfaces a 429 with the retry hint rather than a raw error", async () => {
    mutations.lock.mutateAsync.mockRejectedValue(new FakeApiError("slow down", "card_rate_limited", 429, { retryAfterSec: 42 }));
    const wrapper = render();
    await lockAndConfirm(wrapper);
    expect(toast.error).toHaveBeenCalledWith("Too many card changes just now", expect.stringContaining("42s"));
  });
});

describe("step-up shows the server's own reason (web finding #4)", () => {
  it("passes the API's message into the prompt and re-runs the action after confirming", async () => {
    mutations.lock.mutateAsync.mockRejectedValueOnce(
      new FakeApiError("Confirm your password to unlock a fraud-flagged card.", "step_up_required", 403),
    );
    const wrapper = render();
    await lockAndConfirm(wrapper);

    const prompt = wrapper.find('[data-testid="step-up"]');
    expect(prompt.exists()).toBe(true);
    expect(prompt.attributes("data-reason")).toContain("fraud-flagged");
    expect(toast.error).not.toHaveBeenCalled();

    mutations.lock.mutateAsync.mockResolvedValue({ status: "succeeded", mutationId: "m1" });
    await wrapper.find('[data-testid="step-up-confirm"]').trigger("click");
    await flushPromises();
    expect(mutations.lock.mutateAsync).toHaveBeenCalledTimes(2);
  });
});

describe("re-entrancy", () => {
  it("does not dispatch a second time while the first confirm is in flight", async () => {
    let resolve!: (v: unknown) => void;
    mutations.lock.mutateAsync.mockReturnValue(new Promise((r) => { resolve = r; }));
    const wrapper = render();
    await button(wrapper, "Lock card").trigger("click");
    await flushPromises();
    // Two rapid confirm clicks; the second must be swallowed by the busy guard.
    await button(wrapper, "Lock card").trigger("click");
    await button(wrapper, "Lock card").trigger("click");
    await flushPromises();
    expect(mutations.lock.mutateAsync).toHaveBeenCalledTimes(1);
    resolve({ status: "succeeded", mutationId: "m1" });
    await flushPromises();
  });
});

describe("capabilities decide what exists", () => {
  it("offers only the actions the server granted", () => {
    const wrapper = render({ capabilities: caps({ canOverride: false, canSetPrompts: false }) });
    expect(wrapper.text()).not.toContain("Exception");
    expect(wrapper.text()).not.toContain("Prompts");
  });
});
