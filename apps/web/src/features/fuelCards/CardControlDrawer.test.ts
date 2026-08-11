import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import type { CardCapabilities } from "@fuelguard/shared";
import CardControlDrawer from "./CardControlDrawer.vue";

/**
 * The drawer's job is to make a consequence impossible to reach by accident, so these cases are all
 * about what it REFUSES to do: no write without a reason, no write without a confirmation, no second
 * write while one is in flight, and no cheerful toast for an outcome nobody has confirmed.
 */

const mutations = vi.hoisted(() => ({
  lock: { isPending: { value: false }, mutateAsync: vi.fn() },
  unlock: { isPending: { value: false }, mutateAsync: vi.fn() },
  grant: { isPending: { value: false }, mutateAsync: vi.fn() },
  clear: { isPending: { value: false }, mutateAsync: vi.fn() },
  prompts: { isPending: { value: false }, mutateAsync: vi.fn() },
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));

/**
 * Declared through `vi.hoisted` because `vi.mock`'s factory is hoisted above every top-level
 * statement — a plain class declaration here is not initialised by the time the factory runs.
 */
const FakeApiError = vi.hoisted(() =>
  class FakeApiError extends Error {
    constructor(message: string, public code: string, public status = 409, public detail = {}) {
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
  newIdempotencyKey: () => "11111111-2222-4333-8444-555555555555",
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
    template: `<div data-testid="step-up"><button data-testid="step-up-confirm" @click="$emit('confirmed')">Confirm</button></div>`,
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

async function typeReason(wrapper: VueWrapper, text = "Truck broken into overnight") {
  const input = wrapper.findAll("input").find((i) => i.attributes("placeholder")?.includes("Truck"));
  await input!.setValue(text);
  await flushPromises();
}

afterEach(() => {
  for (const w of wrappers.splice(0)) w.unmount();
  vi.clearAllMocks();
});

describe("the reason comes before the decision", () => {
  it("keeps the primary action disabled until a reason is typed", async () => {
    const wrapper = render();
    expect(button(wrapper, "Lock card").attributes("disabled")).toBeDefined();
    await typeReason(wrapper);
    expect(button(wrapper, "Lock card").attributes("disabled")).toBeUndefined();
  });
});

describe("the confirmation replaces the body rather than stacking on it", () => {
  it("shows the confirmation and only then dispatches", async () => {
    mutations.lock.mutateAsync.mockResolvedValue({ status: "succeeded", mutationId: "m1" });
    const wrapper = render();
    await typeReason(wrapper);
    await button(wrapper, "Lock card").trigger("click");
    await flushPromises();

    // The panel is gone; the confirmation is what is on screen.
    expect(wrapper.text()).toContain("Lock this card?");
    expect(wrapper.text()).toContain("stops working at every location");
    expect(mutations.lock.mutateAsync).not.toHaveBeenCalled();

    await button(wrapper, "Lock card").trigger("click");
    await flushPromises();
    expect(mutations.lock.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("sends the version the screen was drawn from, and one idempotency key", async () => {
    mutations.lock.mutateAsync.mockResolvedValue({ status: "succeeded", mutationId: "m1" });
    const wrapper = render();
    await typeReason(wrapper);
    await button(wrapper, "Lock card").trigger("click");
    await flushPromises();
    await button(wrapper, "Lock card").trigger("click");
    await flushPromises();

    expect(mutations.lock.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        cardId: "card-1",
        expectedVersion: "0123456789abcdef0123456789abcdef",
        reason: "Truck broken into overnight",
        idempotencyKey: "11111111-2222-4333-8444-555555555555",
        status: "Hold",
      }),
    );
  });
});

describe("outcomes an operator must not misread", () => {
  it("does not report an unverified write as success", async () => {
    mutations.lock.mutateAsync.mockResolvedValue({ status: "sent", mutationId: "m1" });
    const wrapper = render();
    await typeReason(wrapper);
    await button(wrapper, "Lock card").trigger("click");
    await flushPromises();
    await button(wrapper, "Lock card").trigger("click");
    await flushPromises();

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith("Sent, but not confirmed", expect.stringContaining("WEX portal"));
    // The drawer stays open: the operator needs to see the card's state, not a closed panel.
    expect(wrapper.emitted("close")).toBeUndefined();
  });

  it("gives a 409 its own handling rather than a raw error toast", async () => {
    mutations.lock.mutateAsync.mockRejectedValue(new FakeApiError("changed", "card_state_changed"));
    const wrapper = render();
    await typeReason(wrapper);
    await button(wrapper, "Lock card").trigger("click");
    await flushPromises();
    await button(wrapper, "Lock card").trigger("click");
    await flushPromises();

    expect(toast.error).toHaveBeenCalledWith("Card changed in EFS", "Review the current settings and try again.");
    // And the page is asked to refetch, so the drawer's next attempt carries the version EFS holds.
    expect(wrapper.emitted("changed")).toBeTruthy();
  });

  it("shows the step-up prompt instead of an error when the API asks for one", async () => {
    mutations.lock.mutateAsync.mockRejectedValueOnce(new FakeApiError("fresh please", "step_up_required", 403));
    const wrapper = render();
    await typeReason(wrapper);
    await button(wrapper, "Lock card").trigger("click");
    await flushPromises();
    await button(wrapper, "Lock card").trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="step-up"]').exists()).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();

    // Confirming re-runs the action that needed it, rather than making the operator start again.
    mutations.lock.mutateAsync.mockResolvedValue({ status: "succeeded", mutationId: "m1" });
    await wrapper.find('[data-testid="step-up-confirm"]').trigger("click");
    await flushPromises();
    expect(mutations.lock.mutateAsync).toHaveBeenCalledTimes(2);
  });
});

describe("capabilities decide what exists", () => {
  it("offers only the actions the server granted", () => {
    const wrapper = render({ capabilities: caps({ canOverride: false, canSetPrompts: false }) });
    expect(wrapper.text()).not.toContain("Exception");
    expect(wrapper.text()).not.toContain("Prompts");
  });
});
