import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import type { CardCapabilities } from "@fuelguard/shared";
import CardOperationDrawer from "./CardOperationDrawer.vue";
import CardOperationInputs from "./CardOperationInputs.vue";
import { operationById, type OperationDraft } from "./cardOperations";

/**
 * One case per invariant from plan Step 6.1, each named for the defect it prevents.
 *
 * The drawer's job is to make a consequence impossible to reach by accident, so these are about what
 * it REFUSES to do and what it must not misreport: no dispatch of a body the operator did not
 * authorise, no overwrite of a half-typed draft, no discard on a stray Escape, no cheerful retry on
 * an outcome nobody confirmed, and no password prompt the header promised would not come.
 */

const mutations = vi.hoisted(() => ({
  lock: { isPending: { value: false }, mutateAsync: vi.fn() },
  unlock: { isPending: { value: false }, mutateAsync: vi.fn() },
  grant: { isPending: { value: false }, mutateAsync: vi.fn() },
  clear: { isPending: { value: false }, mutateAsync: vi.fn() },
  prompts: { isPending: { value: false }, mutateAsync: vi.fn() },
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));

/** A COUNTER, not a constant: rotation is invisible to a mock that returns the same key every time. */
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
    props: ["open", "title", "description", "size"],
    emits: ["close"],
    template: `<aside v-if="open"><h2>{{ title }}</h2><slot /><footer><slot name="footer" /></footer></aside>`,
  },
}));

/**
 * The picker runs its own vue-query search against EFS's location list. Stubbed because these cases
 * are about what the drawer dispatches, and an unmocked one needs a `queryClient` in context — which
 * surfaces as an unhandled rejection that fails the run while every assertion still passes.
 */
vi.mock("./EfsLocationPicker.vue", () => ({
  default: {
    props: ["modelValue", "disabled"],
    emits: ["update:modelValue"],
    template: `<div data-testid="location-picker" />`,
  },
}));

vi.mock("@/components/StepUpPrompt.vue", () => ({
  default: {
    props: ["reason"],
    emits: ["confirmed", "cancel"],
    template: `<div data-testid="step-up" :data-reason="reason"><button data-testid="step-up-confirm" @click="$emit('confirmed')">Confirm</button></div>`,
  },
}));

const ALL_ENABLED = {
  card_lock: null, card_unlock: null, override_grant: null,
  override_clear: null, delete_override: null, prompts_set: null,
};

const caps = (over: Partial<CardCapabilities> = {}): CardCapabilities => ({
  canLock: true, canUnlock: true, canOverride: true, canSetPrompts: true,
  writeEntitlement: "confirmed", blockedBy: null,
  capabilityStates: { ...ALL_ENABLED }, environment: "production", ...over,
});

const wrappers: VueWrapper[] = [];

function render(operationId = "lock", over: Record<string, unknown> = {}) {
  const wrapper = mount(CardOperationDrawer, {
    props: {
      open: true,
      operation: operationById(operationId as never),
      cardId: "card-1",
      maskedRef: "••••3182",
      version: "0123456789abcdef0123456789abcdef",
      status: "Active",
      overrideUses: 0,
      overrideAllLocations: false,
      locationOverrideId: null,
      prompts: [{ infoId: "DRID", validationType: "EXACT_MATCH", matchValue: "D-4471", reportValue: null }],
      capabilities: caps(),
      scopes: ["lock", "unlock", "override", "prompts"],
      ...over,
    },
    // The result region links to the card's history through AppButton's `to`, which renders a
    // RouterLink. Stubbed rather than given a real router: these cases are about what the drawer
    // dispatches and refuses, and a route table would be a second thing able to break them.
    global: { stubs: { RouterLink: { props: ["to"], template: "<a><slot /></a>" } } },
  });
  wrappers.push(wrapper);
  return wrapper;
}

const button = (wrapper: VueWrapper, label: string) => {
  const match = wrapper.findAll("button").find((b) => b.text().trim() === label);
  if (!match) {
    throw new Error(`Button not found: ${label}. Present: ${wrapper.findAll("button").map((b) => b.text().trim()).join(" | ")}`);
  }
  return match;
};

const hasButton = (wrapper: VueWrapper, label: string) =>
  wrapper.findAll("button").some((b) => b.text().trim() === label);

/**
 * Change an input through the SAME `update:draft` contract `CardOperationInputs` uses.
 *
 * Deliberately not `wrapper.vm.draft.x = y`: reaching into a `<script setup>` component's internals
 * would keep passing if the child stopped being wired to the parent at all, which is one of the
 * things these cases are meant to catch. The uses control is an `AppCombobox` and driving it through
 * the DOM would be testing that component instead of this one.
 */
const setDraft = async (wrapper: VueWrapper, over: Partial<OperationDraft>) => {
  const inputs = wrapper.findComponent(CardOperationInputs);
  inputs.vm.$emit("update:draft", { ...(inputs.props("draft") as OperationDraft), ...over });
  await flushPromises();
};

afterEach(() => {
  for (const w of wrappers.splice(0)) w.unmount();
  vi.clearAllMocks();
  keyGen.n = 0;
});

describe("invariant 1 — the payload is frozen when Confirm is pressed", () => {
  it("sends the uses the operator authorised, not the value the form held afterwards", async () => {
    // The defect: a reseed, a stray keystroke or a slow render between the click and the network
    // call means somebody authorised two purchases and the API granted nine.
    let resolve: (v: unknown) => void = () => {};
    mutations.grant.mutateAsync.mockReturnValue(new Promise((r) => { resolve = r; }));

    const wrapper = render("grant");
    await wrapper.find("[data-testid=reason]").setValue("Fuel for the Effingham run");
    await setDraft(wrapper, { uses: 2 });

    await button(wrapper, "Grant exception").trigger("click");
    await flushPromises();

    // Move the form UNDER the in-flight request.
    await setDraft(wrapper, { uses: 9 });

    resolve({ status: "succeeded", mutationId: "m1" });
    await flushPromises();

    const arg = mutations.grant.mutateAsync.mock.calls[0]![0] as { uses: number };
    expect(arg.uses).toBe(2);
  });
});

describe("invariant 2 — reseeding pauses while the draft is dirty", () => {
  it("keeps a half-typed reason when a fresh version arrives, and offers the reload instead", async () => {
    // The defect: the page polls every 60 seconds, so an unguarded reseed wipes whatever the
    // operator was typing at a moment they did not choose.
    const wrapper = render("lock");
    await wrapper.find("[data-testid=reason]").setValue("Stolen from the yard");

    await wrapper.setProps({ version: "9999999999999999abcdef9999999999" });
    await flushPromises();

    expect((wrapper.find("[data-testid=reason]").element as HTMLInputElement).value).toBe("Stolen from the yard");
    expect(hasButton(wrapper, "Reload the card")).toBe(true);
  });

  it("does reseed when nothing has been typed — the pause is for work, not for every refetch", async () => {
    const wrapper = render("lock");
    await wrapper.setProps({ version: "9999999999999999abcdef9999999999" });
    await flushPromises();

    expect(hasButton(wrapper, "Reload the card")).toBe(false);
  });

  /**
   * The pause does NOT extend to a change of card — audit finding web #2.
   *
   * A drawer that stays mounted while the card changes underneath it must re-seed everything, or an
   * action carries card A's draft, reason and idempotency key to card B. There is no half-typed
   * work worth preserving across that, so this is the one case where dirty loses.
   */
  it("still reseeds when the CARD changes, dirty or not — a draft must never cross cards", async () => {
    const wrapper = render("lock");
    await wrapper.find("[data-testid=reason]").setValue("Stolen from the yard");

    await wrapper.setProps({ cardId: "card-2", version: "abcdefabcdefabcdefabcdefabcdef99" });
    await flushPromises();

    expect((wrapper.find("[data-testid=reason]").element as HTMLInputElement).value).toBe("");
    expect(hasButton(wrapper, "Reload the card")).toBe(false);
  });

  it("seeds a usable idempotency key on the FIRST dispatch, not an empty string", async () => {
    // The bug this pins: `dirty` compares an empty initial draft against one seeded from the card's
    // prompts, so it reads true on a drawer nobody has touched. Judged by that, the watcher skipped
    // its own first seed and the first write went out with `Idempotency-Key: ""` — which makes the
    // replay guard inert exactly where a double-submit happens.
    mutations.lock.mutateAsync.mockResolvedValue({ status: "succeeded", mutationId: "m1" });
    const wrapper = render("lock");

    await button(wrapper, "Lock card").trigger("click");
    await flushPromises();

    const arg = mutations.lock.mutateAsync.mock.calls[0]![0] as { idempotencyKey: string };
    expect(arg.idempotencyKey).toBe("key-1");
  });
});

describe("invariant 3 — the dirty guard", () => {
  it("does not close on Cancel when there is work to lose", async () => {
    // The defect: one accidental Escape and a carefully-worded exception is gone.
    const wrapper = render("grant");
    await wrapper.find("[data-testid=reason]").setValue("Approved by dispatch");

    await button(wrapper, "Cancel").trigger("click");
    await flushPromises();

    expect(wrapper.emitted("close")).toBeUndefined();
    expect(hasButton(wrapper, "Discard")).toBe(true);
  });

  it("closes immediately when there is nothing to lose", async () => {
    const wrapper = render("lock");
    await button(wrapper, "Cancel").trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });
});

describe("invariant 4 — the result stays in the drawer", () => {
  it("does not close on a `sent` outcome, and disables the retry", async () => {
    // The most dangerous state in the system: the write reached EFS and the re-read did not confirm
    // it. A retry could apply it twice — a second exception is a second free tank.
    mutations.lock.mutateAsync.mockResolvedValue({ status: "sent", mutationId: "m1" });

    const wrapper = render("lock");
    await button(wrapper, "Lock card").trigger("click");
    await flushPromises();

    expect(wrapper.emitted("close")).toBeUndefined();
    expect(button(wrapper, "Try again").attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("WEX portal");
  });

  it("offers a live retry on a plain failure, which IS safe to repeat", async () => {
    // The pair matters: without it, a drawer that disabled every retry would satisfy the case above
    // for the wrong reason.
    mutations.lock.mutateAsync.mockResolvedValue({ status: "failed", mutationId: "m1", faultMessage: "EFS said no" });

    const wrapper = render("lock");
    await button(wrapper, "Lock card").trigger("click");
    await flushPromises();

    expect(button(wrapper, "Try again").attributes("disabled")).toBeUndefined();
  });
});

describe("invariant 5 — step-up is predicted, not discovered", () => {
  it("asks for the password BEFORE spending a request, once uses pass the threshold", async () => {
    // The defect the shared rule exists for: the drawer promising no password and the server asking
    // for one. Four uses is over CARD_OVERRIDE_STEP_UP_ABOVE_USES.
    const wrapper = render("grant");
    await wrapper.find("[data-testid=reason]").setValue("Breakdown, needs four fills");
    await setDraft(wrapper, { uses: 4 });

    expect(wrapper.text()).toContain("Confirm your password");

    await button(wrapper, "Grant exception").trigger("click");
    await flushPromises();

    // Predicted, so the prompt is shown without a round trip having been spent to learn it.
    expect(wrapper.find("[data-testid=step-up]").exists()).toBe(true);
    expect(mutations.grant.mutateAsync).not.toHaveBeenCalled();
  });

  it("still handles a refusal it did not predict — the mirror can be stale about fraud", async () => {
    // Two of the three gates decide against the document EFS returns at write time, and this only
    // has the mirror. Deleting the fallback in the name of the invariant would turn a stale mirror
    // into a dead end.
    mutations.unlock.mutateAsync.mockRejectedValue(
      new FakeApiError("This card is flagged for fraud. Confirm your password to unlock it.", "step_up_required", 401),
    );

    const wrapper = render("unlock", { status: "Hold" });
    expect(wrapper.text()).not.toContain("flagged for fraud");

    await button(wrapper, "Unlock card").trigger("click");
    await flushPromises();

    expect(wrapper.find("[data-testid=step-up]").attributes("data-reason")).toContain("flagged for fraud");
  });

  it("re-sends the body the operator authorised even if the card polls underneath the prompt", async () => {
    // The form itself is off screen while the password is being typed — the prompt replaces it — so
    // the reachable way for state to move here is the page's own 60s poll. The frozen body has to
    // survive that: what the operator authorised is what the password releases.
    mutations.grant.mutateAsync.mockResolvedValue({ status: "succeeded", mutationId: "m1" });

    const wrapper = render("grant");
    await wrapper.find("[data-testid=reason]").setValue("Four fills approved");
    await setDraft(wrapper, { uses: 4 });
    await button(wrapper, "Grant exception").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid=step-up]").exists()).toBe(true);

    await wrapper.setProps({ version: "7777777777777777abcdef7777777777" });
    await flushPromises();

    await wrapper.find("[data-testid=step-up-confirm]").trigger("click");
    await flushPromises();

    const arg = mutations.grant.mutateAsync.mock.calls[0]![0] as { uses: number; expectedVersion: string };
    expect(arg.uses).toBe(4);
    // And against the version the screen was drawn from, not the one that arrived mid-prompt: a
    // write authorised against one document must not be applied to a newer one behind the operator.
    expect(arg.expectedVersion).toBe("0123456789abcdef0123456789abcdef");
  });
});

describe("invariant 6 — a disabled button names what is missing", () => {
  it("names the missing location rather than just refusing", async () => {
    const wrapper = render("grant");
    await wrapper.find("[data-testid=reason]").setValue("Single stop exception");
    await setDraft(wrapper, { scopeKind: "location" });

    expect(button(wrapper, "Grant exception").attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("Choose the location");
  });

  it("names the missing reason on the one operation that demands one", async () => {
    // `override_grant` is `reason: "required"` — the discretionary end of the range, and "Why" is
    // the first column an auditor reads on it.
    const wrapper = render("grant");
    expect(button(wrapper, "Grant exception").attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("Say why");
  });

  it("never demands a reason for a lock — nobody is stranded at a pump over a text box", async () => {
    mutations.lock.mutateAsync.mockResolvedValue({ status: "succeeded", mutationId: "m1" });
    const wrapper = render("lock");

    expect(button(wrapper, "Lock card").attributes("disabled")).toBeUndefined();
    await button(wrapper, "Lock card").trigger("click");
    await flushPromises();
    expect(mutations.lock.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("says who to ask when this company has never approved the action", async () => {
    // The QA case exactly: `override_grant` is correctly unpromoted there, and before this the
    // drawer showed the button and the API answered 403 after the operator pressed it.
    const wrapper = render("grant", {
      capabilities: caps({ capabilityStates: { ...ALL_ENABLED, override_grant: "not_promoted" } }),
    });

    expect(button(wrapper, "Grant exception").attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("An admin needs to prove it on a test card first");
  });
});

describe("invariant 7 — the header says where the write is going", () => {
  it("badges sandbox, so nobody learns it from a card that did not change", async () => {
    const wrapper = render("lock", { capabilities: caps({ environment: "sandbox" }) });
    expect(wrapper.text()).toContain("Sandbox");
  });

  it("says nothing on production — a badge on every screen is a badge nobody reads", async () => {
    const wrapper = render("lock", { capabilities: caps({ environment: "production" }) });
    expect(wrapper.text()).not.toContain("Sandbox");
  });
});

describe("carried over from the old drawer, because they were right", () => {
  it("re-mints the idempotency key after a settled outcome, so a second attempt is not a replay", async () => {
    mutations.lock.mutateAsync.mockResolvedValue({ status: "failed", mutationId: "m1", faultMessage: "no" });
    const wrapper = render("lock");

    await button(wrapper, "Lock card").trigger("click");
    await flushPromises();
    await button(wrapper, "Try again").trigger("click");
    await flushPromises();
    await button(wrapper, "Lock card").trigger("click");
    await flushPromises();

    const first = (mutations.lock.mutateAsync.mock.calls[0]![0] as { idempotencyKey: string }).idempotencyKey;
    const second = (mutations.lock.mutateAsync.mock.calls[1]![0] as { idempotencyKey: string }).idempotencyKey;
    expect(second).not.toBe(first);
  });

  it("KEEPS the key after `sent`, because a replay is the only safe repeat", async () => {
    mutations.lock.mutateAsync.mockResolvedValue({ status: "sent", mutationId: "m1" });
    const wrapper = render("lock");

    await button(wrapper, "Lock card").trigger("click");
    await flushPromises();

    const sentKey = (mutations.lock.mutateAsync.mock.calls[0]![0] as { idempotencyKey: string }).idempotencyKey;
    expect(sentKey).toBe("key-1");
    // Nothing re-minted it: `keyGen` has handed out exactly one key.
    expect(keyGen.n).toBe(1);
  });

  it("sends the version the screen was DRAWN from, never a fresher one", async () => {
    mutations.lock.mutateAsync.mockResolvedValue({ status: "succeeded", mutationId: "m1" });
    const wrapper = render("lock");

    await button(wrapper, "Lock card").trigger("click");
    await flushPromises();

    const arg = mutations.lock.mutateAsync.mock.calls[0]![0] as { expectedVersion: string };
    expect(arg.expectedVersion).toBe("0123456789abcdef0123456789abcdef");
  });

  it("reads the outcome from `status`, not from the fact the request resolved", async () => {
    mutations.lock.mutateAsync.mockResolvedValue({ status: "failed", mutationId: "m1", faultMessage: "EFS refused" });
    const wrapper = render("lock");

    await button(wrapper, "Lock card").trigger("click");
    await flushPromises();

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });
});

/**
 * Re-homed from `CardControlDrawer.test.ts` when Step 6.4 deleted it. Each one is about a defect
 * that outlived the component it was written against — the drawer changed shape, the ways an
 * operator can be misled did not.
 */
describe("re-homed from the drawer this replaced", () => {
  it("sends a REPORT_ONLY prompt back unchanged on a no-op save", async () => {
    // `replaceAll` means every record the request omits is DELETED (guide p137). A prompt carries
    // its value in one of two fields, and reading only `matchValue` sends a REPORT_ONLY record back
    // with an empty value — a silent edit nobody asked for.
    mutations.prompts.mutateAsync.mockResolvedValue({ status: "succeeded", mutationId: "m1" });
    const wrapper = render("prompts", {
      prompts: [{ infoId: "UNIT", validationType: "REPORT_ONLY", matchValue: null, reportValue: "3182" }],
    });

    // `prompts_set` is `reason: "required"` — the contract's own rule, and the drawer enforces it.
    await wrapper.find("[data-testid=reason]").setValue("Unit number corrected");
    await button(wrapper, "Save prompts").trigger("click");
    await flushPromises();

    const arg = mutations.prompts.mutateAsync.mock.calls[0]![0] as { prompts: Record<string, unknown>[] };
    expect(arg.prompts).toEqual([
      { infoId: "UNIT", validationType: "REPORT_ONLY", matchValue: null, reportValue: "3182", remove: false },
    ]);
  });

  it("calls out an idempotent replay as matching an earlier attempt, not as a fresh success", async () => {
    // The operator clicked twice and deserves to know the second click matched the first. Reporting
    // it as a new success claims a write that never happened.
    mutations.lock.mutateAsync.mockResolvedValue({ status: "succeeded", mutationId: "m1", idempotent: true });
    const wrapper = render("lock");

    await button(wrapper, "Lock card").trigger("click");
    await flushPromises();

    expect(toast.success).toHaveBeenCalledWith("Already done", expect.stringContaining("earlier attempt"));
  });

  it("does not dispatch a second time while the first confirm is in flight", async () => {
    // Web finding #5. A slow vendor call and an impatient click is how one override becomes two.
    let resolve: (v: unknown) => void = () => {};
    mutations.lock.mutateAsync.mockReturnValue(new Promise((r) => { resolve = r; }));
    const wrapper = render("lock");

    await button(wrapper, "Lock card").trigger("click");
    await flushPromises();
    await button(wrapper, "Locking…").trigger("click");
    await flushPromises();

    expect(mutations.lock.mutateAsync).toHaveBeenCalledTimes(1);
    resolve({ status: "succeeded", mutationId: "m1" });
    await flushPromises();
  });

  it("retries a 409 with the version EFS returned, not the one the page still shows", async () => {
    // The whole point of `expectedVersion`: retrying with the stale one is a guaranteed second 409
    // that still spends a vendor call and an hourly-cap slot.
    const live = { status: "Active", infos: [{ infoId: "DRID", validationType: "EXACT_MATCH", matchValue: "L-1", reportValue: null }] };
    mutations.lock.mutateAsync
      .mockRejectedValueOnce(new FakeApiError("moved", "card_state_changed", 409, { currentVersion: "f".repeat(32), card: live }))
      .mockResolvedValueOnce({ status: "succeeded", mutationId: "m2" });

    const wrapper = render("lock");
    await button(wrapper, "Lock card").trigger("click");
    await flushPromises();
    await button(wrapper, "Lock card").trigger("click");
    await flushPromises();

    const second = mutations.lock.mutateAsync.mock.calls[1]![0] as { expectedVersion: string };
    expect(second.expectedVersion).toBe("f".repeat(32));
  });
});

describe("the operation catalogue decides what is worth offering", () => {
  it("offers Deactivate on a card that is already on Hold — the Step 6.2 correction", () => {
    // The old drawer offered Inactive only inside the Lock control, so a held card could not be
    // retired without unlocking it first: two writes, and a window where it works again.
    expect(operationById("deactivate")!.applies({
      status: "HOLD", infos: [], limits: [], overrideUses: 0,
      overrideAllLocations: false, locationOverrideId: null,
    })).toBe(true);
  });

  it("offers Remove exception on residue with zero uses left — the other Step 6.2 correction", () => {
    // `overrideUses > 0` is the right test for "is an exception ACTIVE" and the wrong one for "is
    // there something to clear". A card carrying a location scope with no uses was unreachable.
    expect(operationById("clear")!.applies({
      status: "Active", infos: [], limits: [], overrideUses: 0,
      overrideAllLocations: false, locationOverrideId: "442",
    })).toBe(true);
  });

  it("does not offer Lock on a card that is already held — a write that changes nothing still costs a slot", () => {
    expect(operationById("lock")!.applies({
      status: "HOLD", infos: [], limits: [], overrideUses: 0,
      overrideAllLocations: false, locationOverrideId: null,
    })).toBe(false);
  });
});
