import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import type { StockLineDto } from "@silvicom/shared";

/**
 * The desk verbs' drawer (INVENTORY-PLAN.md I5 PR 2a).
 *
 * ── ⚠ THE ASSERTION THIS FILE EXISTS FOR ──────────────────────────────────────────────────────
 * **The movement id is minted once per MOVEMENT and reused on every attempt (D-INV27).** That is
 * the server half of the offline queue: `record_part_movement` returns the row it already has for
 * an id it has seen, so a replay is free — but only if the client sends the same id. A drawer that
 * minted inside its submit handler would send a new id per attempt, every retry would become a
 * second movement, the shelf would drift by exactly the number of times the network was bad, and
 * **no other test in this repo would fail**: the hook passes ids through, the route validates them,
 * the RPC honours them, and every one of those layers is perfectly correct in isolation.
 *
 * So the retry is staged here: the first submit is rejected the way a bad connection rejects it,
 * the technician presses again, and the two calls must carry one id.
 *
 * The rest is the other half of "the shapes are the rules": each verb validates against its own
 * schema from `@silvicom/shared`, so an issue with no unit and an adjustment of zero never leave
 * the browser.
 */

/** Roster ids are uuids, and the contract says so — a short stub is refused for the wrong reason. */
const VEHICLE = "44444444-4444-4444-8444-444444444444";
const TRAILER = "55555555-5555-4555-8555-555555555555";

const record = vi.hoisted(() => ({
  mutateAsync: vi.fn(async (_input: Record<string, unknown>) => ({ id: "m-1" })),
  isPending: { value: false },
}));
vi.mock("@/features/inventory/useInventory", () => ({ useRecordMovement: () => record }));
vi.mock("@/composables/useVehicles", () => ({
  useVehiclesQuery: () => ({ data: ref([{ id: VEHICLE, unit_number: "654" }]) }),
}));
vi.mock("@/composables/useTrailers", () => ({
  useTrailersQuery: () => ({ data: ref([{ id: TRAILER, unit_number: "T-4102" }]) }),
}));

const MovementDrawer = (await import("@/features/inventory/MovementDrawer.vue")).default;

const SlideOverStub = {
  template: "<div><slot /><slot name='footer' /></div>",
  props: ["open", "title", "size", "description"],
};

const LINE: StockLineDto = {
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
};

const LOCATIONS = [
  { id: LINE.locationId, name: "Main shop", code: "MAIN", address: null, active: true },
  { id: "33333333-3333-4333-8333-333333333333", name: "Yard", code: "YARD", address: null, active: true },
];

const drawer = (verb: string) =>
  mount(MovementDrawer, {
    props: { open: true, verb, line: LINE, locations: LOCATIONS } as never,
    global: { stubs: { SlideOver: SlideOverStub } },
  });

type W = ReturnType<typeof drawer>;
const submit = (w: W) => w.find("form").trigger("submit");
const type = async (w: W, label: string, value: string) => {
  const field = w.findAll("label").find((l) => l.text().startsWith(label))!;
  const input = w.find(`#${field.attributes("for")}`);
  await input.setValue(value);
};
const sentIds = () => record.mutateAsync.mock.calls.map((c) => (c[0] as { id: string }).id);
const lastSent = () => record.mutateAsync.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;

beforeEach(() => {
  setActivePinia(createPinia());
  record.mutateAsync.mockClear();
  record.mutateAsync.mockImplementation(async () => ({ id: "m-1" }));
});

describe("the movement id (D-INV27)", () => {
  it("sends ONE id across a failed attempt and the retry that follows it", async () => {
    const w = drawer("received");
    await type(w, "Quantity", "24");

    // The connection drops on the first press — exactly what the offline queue exists for.
    record.mutateAsync.mockRejectedValueOnce(new Error("network"));
    await submit(w);
    await submit(w);

    expect(sentIds()).toHaveLength(2);
    expect(sentIds()[0]).toBe(sentIds()[1]);
  });

  it("gives two separate movements two separate ids", async () => {
    const first = drawer("received");
    await type(first, "Quantity", "24");
    await submit(first);

    const second = drawer("received");
    await type(second, "Quantity", "12");
    await submit(second);

    expect(sentIds()[0]).not.toBe(sentIds()[1]);
  });

  /**
   * ⚠ This assertion was rewritten after being MEASURED, and the correction is worth recording.
   * Its first form simply pressed submit twice and compared the two `occurredAt` values — and it
   * passed against a drawer that re-clocked on every attempt, because both presses land inside the
   * same millisecond. It proved nothing at all. The clock has to actually move between the attempts
   * for the question to be asked, which is what `vi.useFakeTimers` is doing here.
   */
  it("clocks the movement once, so a retry is not re-timed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-09T10:00:00.000Z"));
    try {
      const w = drawer("received");
      await type(w, "Quantity", "24");
      record.mutateAsync.mockRejectedValueOnce(new Error("network"));
      await submit(w);
      vi.setSystemTime(new Date("2026-09-09T10:04:00.000Z"));
      await submit(w);
      const times = record.mutateAsync.mock.calls.map((c) => (c[0] as { occurredAt: string }).occurredAt);
      expect(times[0]).toBe("2026-09-09T10:00:00.000Z");
      expect(times[1]).toBe(times[0]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the shapes are the rules", () => {
  it("refuses an issue with no unit, in the browser", async () => {
    const w = drawer("issued");
    await type(w, "Quantity", "2");
    await submit(w);
    expect(record.mutateAsync).not.toHaveBeenCalled();
    expect(w.text()).toContain("exactly one unit");
  });

  it("names the unit's own column rather than sending both", async () => {
    const w = drawer("issued");
    await type(w, "Quantity", "2");
    // The picker's value carries which kind it is; the payload must land on one column.
    (w.vm as unknown as { form: { unit: string } }).form.unit = `trailer:${TRAILER}`;
    await submit(w);
    expect(lastSent()).toMatchObject({ trailerId: TRAILER, vehicleId: null });
  });

  it("refuses an adjustment of nothing, because a row that explains nothing is not a correction", async () => {
    const w = drawer("adjusted");
    await type(w, "Change", "0");
    await submit(w);
    expect(record.mutateAsync).not.toHaveBeenCalled();
  });

  it("carries the adjust reason, which is mandatory and is why the verb is separate", async () => {
    const w = drawer("adjusted");
    await type(w, "Change", "-2");
    await submit(w);
    expect(lastSent()).toMatchObject({ reason: "adjusted", quantityDelta: -2, adjustReason: "correction" });
  });

  it("refuses a transfer to the shelf it is already on", async () => {
    const w = drawer("transferred");
    await type(w, "Quantity", "3");
    (w.vm as unknown as { form: { toLocationId: string } }).form.toLocationId = LINE.locationId;
    await submit(w);
    expect(record.mutateAsync).not.toHaveBeenCalled();
    // Asserted by MESSAGE, not only by "it did not send": an empty destination would also send
    // nothing, so a bare `not.toHaveBeenCalled()` would pass against a drawer whose picker was
    // simply broken.
    expect(w.text()).toContain("different location");
  });

  it("does not offer the current shelf as a destination in the first place", async () => {
    const w = drawer("transferred");
    const options = (w.vm as unknown as { destinations: Array<{ value: string }> }).destinations;
    expect(options.map((o) => o.value)).not.toContain(LINE.locationId);
  });
});

/**
 * Q9 (owner, 2026-09-09): stock arriving is received in FleetPal and ingested, and this verb is the
 * manual path for what was bought outside a purchase order. The drawer has to SAY that, because the
 * failure the ruling prevents is a shop that types every delivery into both systems out of habit —
 * and a ruling nobody can see from the screen is a ruling that decays.
 */
describe("the receive drawer says it is the manual path", () => {
  it("names the purchase-order path on receive", () => {
    expect(drawer("received").text()).toContain("bought outside a purchase order");
  });

  it("...and says it nowhere else", () => {
    expect(drawer("issued").text()).not.toContain("purchase order");
    expect(drawer("adjusted").text()).not.toContain("purchase order");
  });
});
