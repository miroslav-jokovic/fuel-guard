import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { HOME_TIME_DEFAULTS, type HomeTimePeriod } from "@silvicom/shared";
import HomeTimeForm from "./HomeTimeForm.vue";

/**
 * The home-time form (HOME-TIME-PLAN §3.3): what it sends, on the carrier's clock, and what it refuses
 * before sending. The date-time picker is stubbed with a plain input speaking the picker's own wire
 * string (`yyyy-MM-ddTHH:mm`); the picker itself is `@silvicom/ui`'s to test.
 */
const ZONE = "America/Chicago";
const NOW = new Date("2026-11-13T15:00:00Z"); // 09:00 Central
const DRIVER = "66666666-8888-4999-8aaa-bbbbbbbbbbb1";
const TRUCK = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";

const DateTimeStub = {
  props: ["modelValue", "invalid"],
  emits: ["update:modelValue"],
  template: `<input data-dt :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
};
const base = { driverId: DRIVER, vehicleId: TRUCK as string | null, unitNumber: "702" as string | null, settings: HOME_TIME_DEFAULTS, zone: ZONE };
const render = (props: Record<string, unknown> = {}) =>
  mount(HomeTimeForm, { props: { ...base, ...props }, global: { stubs: { AppDateTimeField: DateTimeStub } } });
const fields = (w: VueWrapper) => w.findAll("[data-dt]");
const setReturns = (w: VueWrapper, wall: string) => fields(w)[1]!.setValue(wall);
const setLeaves = (w: VueWrapper, wall: string) => fields(w)[0]!.setValue(wall);
const choose = (w: VueWrapper, label: string) => w.findAll("label").find((l) => l.text() === label)!.find("input[type=radio]").setValue(true);
const submit = (w: VueWrapper) => w.get("form").trigger("submit");
/** The truck answers that are selected; a label without a radio (a field's own label) is not one. */
const checkedLabels = (w: VueWrapper) =>
  w.findAll("label").filter((l) => l.find("input[type=radio]").exists() && (l.find("input[type=radio]").element as HTMLInputElement).checked).map((l) => l.text());

const period = (o: Partial<HomeTimePeriod> = {}): HomeTimePeriod => ({
  id: "50000000-0000-4000-8000-00000000000a", driverId: DRIVER, driverName: "Marcus Hill", vehicleId: TRUCK, unitNumber: "702",
  disposition: "with_driver", startAt: "2026-11-11T15:00:00.000Z", expectedReturnAt: "2026-11-16T14:00:00.000Z", endAt: null, endReason: null,
  canceledAt: null, state: "active", markedByName: "Dana", createdAt: "2026-11-11T15:00:00.000Z", updatedAt: "2026-11-11T15:00:00.000Z", ...o,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("marking a new period", () => {
  it("opens on now for Leaves, an empty Returns, and no truck answer the first time", () => {
    const w = render();
    expect((fields(w)[0]!.element as HTMLInputElement).value).toBe("2026-11-13T09:00");
    expect((fields(w)[1]!.element as HTMLInputElement).value).toBe("");
    expect(w.findAll("input[type=radio]").filter((r) => (r.element as HTMLInputElement).checked)).toHaveLength(0);
    expect(w.text()).toContain("Truck 702");
  });

  it("starts Leaves when the truck empties, for a driver who is still on a load", () => {
    const w = render({ leavesHint: "2026-11-14T22:00:00.000Z" });
    expect((fields(w)[0]!.element as HTMLInputElement).value).toBe("2026-11-14T16:00");
  });

  it("pre-selects this driver's answer from last time", () => {
    const w = render({ lastDisposition: "at_yard" });
    const checked = checkedLabels(w);
    expect(checked).toEqual(["Stays at the yard"]);
  });

  it("sends the two times as instants read on the carrier's clock, with the truck", async () => {
    const w = render();
    await setReturns(w, "2026-11-18T08:00");
    await choose(w, "Goes home with the driver");
    await submit(w);
    expect(w.emitted("mark")).toEqual([[
      { driverId: DRIVER, startAt: "2026-11-13T15:00:00.000Z", expectedReturnAt: "2026-11-18T14:00:00.000Z", disposition: "with_driver", vehicleId: TRUCK },
    ]]);
  });

  it("asks nothing about a truck for a driver who has none, and sends 'no truck'", async () => {
    const w = render({ vehicleId: null, unitNumber: null });
    expect(w.findAll("input[type=radio]")).toHaveLength(0);
    await setReturns(w, "2026-11-18T08:00");
    await submit(w);
    expect(w.emitted("mark")![0]![0]).toMatchObject({ disposition: "no_truck", vehicleId: null });
  });

  it("refuses an empty return, a missing truck answer, a return that has passed and one before the start — and sends nothing", async () => {
    const w = render();
    await submit(w);
    expect(w.text()).toContain("Enter when the driver is due back");
    expect(w.text()).toContain("Say where the truck is");
    await choose(w, "Stays at the yard");
    await setLeaves(w, "2026-11-10T09:00");
    await setReturns(w, "2026-11-12T08:00");
    await submit(w);
    expect(w.text()).toContain("That return time has passed");
    await setLeaves(w, "2026-11-20T09:00");
    await setReturns(w, "2026-11-19T08:00");
    await submit(w);
    expect(w.text()).toContain("The return must be after the start");
    expect(w.emitted("mark")).toBeUndefined();
  });

  it("refuses a start more than thirty days back", async () => {
    const w = render();
    await setLeaves(w, "2026-10-01T09:00");
    await setReturns(w, "2026-11-18T08:00");
    await choose(w, "Stays at the yard");
    await submit(w);
    expect(w.text()).toContain("at most 30 days back");
    expect(w.emitted("mark")).toBeUndefined();
  });

  it("says before Save that the truck would be home past the limit — and still saves", async () => {
    const w = render();
    await choose(w, "Goes home with the driver");
    await setReturns(w, "2026-11-20T08:00"); // 6 d 23 h: inside the 8 days
    expect(w.find("[data-testid=home-time-over-limit]").exists()).toBe(false);
    await setReturns(w, "2026-11-24T08:00"); // 10 d 23 h
    expect(w.get("[data-testid=home-time-over-limit]").text()).toContain("10 days");
    expect(w.get("[data-testid=home-time-over-limit]").text()).toContain("limit is 8 days");
    await choose(w, "Stays at the yard");
    expect(w.find("[data-testid=home-time-over-limit]").exists()).toBe(false);
    await submit(w);
    expect(w.emitted("mark")).toHaveLength(1);
  });
});

describe("changing a live period", () => {
  it("opens on the period's own times and truck answer, on the carrier's clock", () => {
    const w = render({ period: period() });
    expect(fields(w).map((f) => (f.element as HTMLInputElement).value)).toEqual(["2026-11-11T09:00", "2026-11-16T08:00"]);
    const checked = checkedLabels(w);
    expect(checked).toEqual(["Goes home with the driver"]);
  });

  it("sends only what moved", async () => {
    const w = render({ period: period() });
    await setReturns(w, "2026-11-19T08:00");
    await submit(w);
    expect(w.emitted("change")).toEqual([[{ expectedReturnAt: "2026-11-19T14:00:00.000Z" }]]);
    const again = render({ period: period() });
    await choose(again, "Stays at the yard");
    await submit(again);
    expect(again.emitted("change")).toEqual([[{ disposition: "at_yard" }]]);
  });

  it("sends an empty change when nothing moved, for the drawer to close on", async () => {
    const w = render({ period: period() });
    await submit(w);
    expect(w.emitted("change")).toEqual([[{}]]);
  });

  it("lets an overdue period's truck go back to the yard without judging its passed return", async () => {
    const w = render({ period: period({ expectedReturnAt: "2026-11-12T14:00:00.000Z", state: "overdue" }) });
    await choose(w, "Stays at the yard");
    await submit(w);
    expect(w.emitted("change")).toEqual([[{ disposition: "at_yard" }]]);
  });

  it("refuses to MOVE the return to a time that has passed", async () => {
    const w = render({ period: period() });
    await setReturns(w, "2026-11-12T08:00");
    await submit(w);
    expect(w.text()).toContain("That return time has passed");
    expect(w.emitted("change")).toBeUndefined();
  });

  it("offers no truck question on a period marked with no truck", () => {
    const w = render({ period: period({ disposition: "no_truck", vehicleId: null, unitNumber: null }), vehicleId: null, unitNumber: null });
    expect(w.findAll("input[type=radio]")).toHaveLength(0);
  });
});
