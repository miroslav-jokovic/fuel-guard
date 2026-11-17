import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";

/**
 * The toll-tag dialog (TOLLS-PER-TRUCK-PLAN.md TL2). What the money depends on: the time sent is the
 * instant the office's clock named, not the browser's; a tag already on file is offered to be moved
 * here rather than registered twice; taking a tag off is a move to no truck; and a void needs a reason.
 */
const calls = vi.hoisted(() => ({
  register: vi.fn(),
  move: vi.fn(),
  retire: vi.fn(),
  voidEntry: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
vi.mock("./useTollTags", async (orig) => {
  const real = await orig<typeof import("./useTollTags")>();
  const m = (fn: (...a: unknown[]) => unknown) => ({ mutateAsync: fn, isPending: ref(false) });
  return { ...real, useTollTagWrites: () => ({ register: m(calls.register), move: m(calls.move), retire: m(calls.retire), voidEntry: m(calls.voidEntry) }) };
});
vi.mock("@/composables/useVehicles", () => ({
  useVehiclesQuery: () => ({ data: ref([{ id: "v-654", unit_number: "654", status: "active" }, { id: "v-702", unit_number: "702", status: "active" }]) }),
}));
vi.mock("@/composables/useOrgTimezone", async () => {
  const { computed } = await import("vue");
  return { useOrgTimezone: () => ({ zone: computed(() => "America/Chicago"), isResolved: computed(() => true) }) };
});
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));

const { TollTagError } = await import("./useTollTags");
const TollTagDialog = (await import("./TollTagDialog.vue")).default;

const TAG = {
  id: "t-1", provider: "ezpass" as const, tagNumber: "00812345678", issuer: null, note: null, retiredAt: null, retiredReason: null,
  currentVehicleId: "v-702", history: [],
};
/** 09:00 in Chicago on June 10 (CDT, UTC-5). */
const NOW = new Date("2026-06-10T14:00:00.000Z");

const open = async (action: unknown) => {
  const w = mount(TollTagDialog, { props: { action, vehicleId: "v-654", unitNumber: "654" } as never, attachTo: document.body });
  await flushPromises();
  return w;
};
const q = (sel: string) => document.body.querySelector(sel);
const field = (name: string) => {
  const el = q(`[data-test=${name}]`)!;
  return (el.matches("input, textarea") ? el : el.querySelector("input, textarea")) as HTMLInputElement;
};
const type = async (name: string, value: string) => {
  const el = field(name);
  el.value = value;
  el.dispatchEvent(new Event("input"));
  await flushPromises();
};
const submit = () => q("[data-test=toll-tag-submit]") as HTMLButtonElement;
const text = () => document.body.textContent ?? "";

beforeEach(() => {
  document.body.innerHTML = "";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  for (const fn of Object.values(calls)) fn.mockReset().mockResolvedValue(TAG);
});

describe("adding a tag", () => {
  it("registers it on this truck from the time the company's clock shows, sent as that instant", async () => {
    await open({ kind: "add" });
    await type("tag-number", "008-1234 5678");
    submit().click();
    await flushPromises();
    expect(calls.register).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "ezpass", tagNumber: "008-1234 5678", vehicleId: "v-654", at: "2026-06-10T14:00:00.000Z" }),
    );
  });

  it("will not send a number that cannot be a tag", async () => {
    await open({ kind: "add" });
    await type("tag-number", "0081/2345");
    expect(submit().disabled).toBe(true);
    expect(text()).toContain("A tag number is 4 to 24 letters and digits.");
  });

  it("offers to move a tag already on file here, instead of registering it twice", async () => {
    calls.register.mockRejectedValue(new TollTagError("That tag is already on file. Open it to move it to another truck.", "already_registered", TAG));
    await open({ kind: "add" });
    await type("tag-number", "00812345678");
    submit().click();
    await flushPromises();
    expect(text()).toContain("already on file");
    (q("[data-test=move-existing]") as HTMLButtonElement).click();
    await flushPromises();
    expect(calls.move).toHaveBeenCalledWith({ id: "t-1", input: { vehicleId: "v-654", at: "2026-06-10T14:00:00.000Z" } });
  });

  it("shows the API's sentence when the history refuses, and stays open", async () => {
    calls.register.mockRejectedValue(new TollTagError("That tag is already on a truck for part of that time.", "tag_overlap", null));
    const w = await open({ kind: "add" });
    await type("tag-number", "00812345678");
    submit().click();
    await flushPromises();
    expect(q("[data-test=toll-tag-error]")?.textContent).toContain("already on a truck for part of that time");
    expect(q("[data-test=move-existing]")).toBeNull();
    expect(w.emitted("close")).toBeUndefined();
  });
});

describe("moving, retiring and correcting", () => {
  it("takes a tag off its truck as a move to no truck, at the time shown", async () => {
    const w = await open({ kind: "move", tag: TAG });
    submit().click();
    await flushPromises();
    expect(calls.move).toHaveBeenCalledWith({ id: "t-1", input: { vehicleId: null, at: "2026-06-10T14:00:00.000Z" } });
    expect(w.emitted("close")).toHaveLength(1);
  });

  it("retires with a reason and a time", async () => {
    await open({ kind: "retire", tag: TAG });
    submit().click();
    await flushPromises();
    expect(calls.retire).toHaveBeenCalledWith({ id: "t-1", input: { reason: "lost", at: "2026-06-10T14:00:00.000Z" } });
  });

  it("voids an entry only once somebody has said what was wrong with it", async () => {
    await open({ kind: "void", tag: TAG, entryId: "a-1", entryLabel: "Unit 702, 06/01/2026 to now" });
    expect(submit().disabled).toBe(true);
    await type("void-reason", "typed the wrong truck");
    submit().click();
    await flushPromises();
    expect(calls.voidEntry).toHaveBeenCalledWith({ id: "a-1", input: { reason: "typed the wrong truck" } });
  });
});
