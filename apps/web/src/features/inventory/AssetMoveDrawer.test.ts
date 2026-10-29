import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import type { AssetDto, AssetTypeDto } from "@silvicom/shared";

/**
 * Move an asset, or report a problem (INVENTORY-PLAN.md I8).
 *
 * ── ⚠ THE TWO ASSERTIONS THIS FILE EXISTS FOR ─────────────────────────────────────────────────
 * **1. The movement id is minted once per MOVEMENT and reused on every attempt (D-INV27).** The
 * server half of the offline queue: `move_asset` returns the row it already has for an id it has
 * seen, so a replay is free — but only if the client sends the same id. A drawer minting inside its
 * submit handler would send a new id per attempt, a tablet would appear to have moved once for every
 * time the network was bad, and **no other test in this repo would fail**: the hook passes ids
 * through, the route validates them, the RPC honours them, and each layer is correct in isolation.
 * So the retry is staged here — first submit rejected the way a bad connection rejects it, second
 * press, one id.
 *
 * **2. A report does not carry a destination (D-INV24).** A fridge reported missing from 654 is
 * still 654's fridge, missing from it. The rule holds in three places — the CHECK in 0333,
 * `reportAssetSchema` at the edge, and this drawer, which must not even offer the field. Pinned by
 * what is SENT, because zod strips unknown keys: asserting the form's shape would prove nothing.
 */

const CRIB = "11111111-1111-4111-8111-111111111111";
const VEHICLE = "44444444-4444-4444-8444-444444444444";
const TRAILER = "55555555-5555-4555-8555-555555555555";

const record = vi.hoisted(() => ({
  mutateAsync: vi.fn(async (_input: Record<string, unknown>) => ({ id: "m-1" })),
  isPending: { value: false },
}));
const DANA = "66666666-6666-4666-8666-666666666666";
const LEE = "77777777-7777-4777-8777-777777777777";
const GONE = "88888888-8888-4888-8888-888888888888";
const BENCH = "99999999-9999-4999-8999-999999999999";
/** Mutable per test: the type's `held_by` is what the drawer reads, never its name. */
const heldBy = vi.hoisted(() => ({ value: "unit" as "unit" | "driver" }));
vi.mock("@/features/inventory/useAssets", () => ({
  useMoveAsset: () => record,
  useAssetTypesQuery: () => ({
    data: ref<AssetTypeDto[]>([
      {
        id: "33333333-3333-4333-8333-333333333333",
        name: "Tablet",
        category: null,
        serialized: true,
        defaultKitQuantity: 1,
        imagePath: null,
        heldBy: heldBy.value,
      },
    ]),
  }),
}));
vi.mock("@/composables/useDrivers", () => ({
  useDriversQuery: () => ({
    data: ref([
      { id: "66666666-6666-4666-8666-666666666666", full_name: "Dana Reyes", status: "active", archived_at: null },
      { id: "77777777-7777-4777-8777-777777777777", full_name: "Lee Park", status: "on_leave", archived_at: null },
      { id: "88888888-8888-4888-8888-888888888888", full_name: "Sam Gone", status: "terminated", archived_at: null },
    ]),
  }),
}));
vi.mock("@/composables/useVehicles", () => ({
  useVehiclesQuery: () => ({ data: ref([{ id: VEHICLE, unit_number: "654" }]) }),
}));
vi.mock("@/composables/useTrailers", () => ({
  useTrailersQuery: () => ({ data: ref([{ id: TRAILER, unit_number: "T-4102" }]) }),
}));

const AssetMoveDrawer = (await import("@/features/inventory/AssetMoveDrawer.vue")).default;

const SlideOverStub = {
  template: "<div><slot /><slot name='footer' /></div>",
  props: ["open", "title", "size", "description"],
};

const ASSET: AssetDto = {
  id: "22222222-2222-4222-8222-222222222222",
  tagCode: null,
  displayNo: "A-0412",
  assetTypeId: "33333333-3333-4333-8333-333333333333",
  assetTypeName: "Tablet",
  name: "Cab tablet",
  serialNumber: "SN-1",
  imei: null,
  model: null,
  manufacturer: null,
  status: "in_service",
  condition: "good",
  holder: { kind: "vehicle", id: VEHICLE, label: "654", inferredDriverName: "Dana Reyes", since: null },
  purchasedAt: null,
  purchaseCost: null,
  warrantyExpiresAt: null,
  purchaseId: null,
  imagePath: null,
  notes: null,
};

const LOCATIONS = [{ id: CRIB, name: "Tool crib", code: "CRIB", address: null, active: true }];

const drawer = (mode: "move" | "report", asset: AssetDto = ASSET, locations = LOCATIONS) =>
  mount(AssetMoveDrawer, {
    props: { open: true, asset, mode, locations } as never,
    global: { stubs: { SlideOver: SlideOverStub } },
  });

type W = ReturnType<typeof drawer>;
const submit = (w: W) => w.find("form").trigger("submit");
/**
 * The holder picker is an `AppCombobox`, not a `<select>`, so its value is set on the component the
 * way `MovementDrawer.test.ts` sets its unit picker. Driving the listbox through the DOM would be
 * testing `AppCombobox`, which `@silvicom/ui` already does.
 */
const setHolder = async (w: W, value: string) => {
  (w.vm as unknown as { form: { holder: string } }).form.holder = value;
  await w.vm.$nextTick();
};
const setReason = async (w: W, value: string) => {
  (w.vm as unknown as { form: { reason: string } }).form.reason = value;
  await w.vm.$nextTick();
};
const sentIds = () => record.mutateAsync.mock.calls.map((c) => (c[0] as { id: string }).id);
const lastSent = () => record.mutateAsync.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;

beforeEach(() => {
  setActivePinia(createPinia());
  record.mutateAsync.mockClear();
  record.mutateAsync.mockImplementation(async () => ({ id: "m-1" }));
  heldBy.value = "unit";
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the movement id (D-INV27)", () => {
  it("sends ONE id across a failed attempt and the retry that follows it", async () => {
    const w = drawer("report");
    // The connection drops on the first press — exactly what the offline queue exists for.
    record.mutateAsync.mockRejectedValueOnce(new Error("network"));
    await submit(w);
    await submit(w);

    expect(sentIds()).toHaveLength(2);
    expect(sentIds()[0]).toBe(sentIds()[1]);
  });

  it("gives two separate movements two separate ids", async () => {
    await submit(drawer("report"));
    await submit(drawer("report"));
    expect(sentIds()[0]).not.toBe(sentIds()[1]);
  });

  /**
   * ⚠ The clock has to actually MOVE between the attempts or the question is not asked at all —
   * `MovementDrawer.test.ts` records the same correction: its first form pressed submit twice and
   * compared the timestamps, and passed against a drawer that re-clocked every attempt, because
   * both presses land inside one millisecond.
   */
  it("clocks the movement once, so a retry is not re-timed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-09T10:00:00.000Z"));
    const w = drawer("report");
    record.mutateAsync.mockRejectedValueOnce(new Error("network"));
    await submit(w);
    vi.setSystemTime(new Date("2026-09-09T10:04:00.000Z"));
    await submit(w);
    const times = record.mutateAsync.mock.calls.map((c) => (c[0] as { occurredAt: string }).occurredAt);
    expect(times[0]).toBe("2026-09-09T10:00:00.000Z");
    expect(times[1]).toBe(times[0]);
  });
});

describe("a report moves nothing (D-INV24)", () => {
  it("offers no destination and sends none", async () => {
    const w = drawer("report");
    expect(w.findAll("label").some((l) => l.text().startsWith("Where it goes"))).toBe(false);
    await submit(w);
    const sent = lastSent()!;
    expect(sent.reason).toBe("reported_missing");
    // Asserted on what was SENT, not on the form: zod strips unknown keys, so a shape assertion
    // would pass against a drawer that bound a destination and let the schema drop it.
    expect(sent.toLocationId).toBeNull();
    expect(sent.toVehicleId).toBeNull();
    expect(sent.toTrailerId).toBeNull();
  });

  it("offers only the reasons that belong to its half", () => {
    const reasons = (mode: "move" | "report") =>
      (drawer(mode).vm as unknown as { reasons: string[] }).reasons;
    const move = reasons("move");
    const report = reasons("report");
    expect(move).toContain("assigned");
    expect(move).not.toContain("reported_missing");
    expect(report).toEqual(["reported_missing", "reported_damaged"]);
  });
});

describe("moving it", () => {
  it("names the column the picked holder belongs to, and only that one", async () => {
    const w = drawer("move");
    await setHolder(w, `vehicle:${VEHICLE}`);
    await submit(w);
    const sent = lastSent()!;
    expect(sent).toMatchObject({ reason: "assigned", toVehicleId: VEHICLE });
    expect(sent.toLocationId).toBeNull();
    expect(sent.toTrailerId).toBeNull();
  });

  it("moves it to a bay when a bay is picked", async () => {
    const w = drawer("move");
    await setHolder(w, `location:${CRIB}`);
    await submit(w);
    expect(lastSent()).toMatchObject({ toLocationId: CRIB, toVehicleId: null });
  });

  /**
   * 0333 nulls all three holder columns for a `retired` movement whatever the payload says, so a
   * picker offering a destination would be a control the database overrules. The screen agrees with
   * the RPC instead of arguing with it.
   */
  it("hides the destination for retiring, and sends nowhere", async () => {
    const w = drawer("move");
    await setHolder(w, `vehicle:${VEHICLE}`);
    await setReason(w, "retired");
    expect(w.findAll("label").some((l) => l.text().startsWith("Where it goes"))).toBe(false);
    await submit(w);
    expect(lastSent()).toMatchObject({ reason: "retired", toVehicleId: null, toLocationId: null });
  });
});

describe("a driver's tablet (DE2b, D-DE1)", () => {
  const ON_SHELF: AssetDto = { ...ASSET, holder: { kind: "location", id: CRIB, label: "Tool crib", inferredDriverName: null, since: null } };
  const WITH_DANA: AssetDto = { ...ASSET, holder: { kind: "driver", id: DANA, label: "Dana Reyes", inferredDriverName: null, since: null } };
  const vm = (w: W) => w.vm as unknown as { tablet: boolean; verb: string; driverOptions: { value: string }[]; holderOptions: { value: string }[] };
  const setVerb = async (w: W, v: string) => {
    vm(w).verb = v;
    await w.vm.$nextTick();
  };

  it("never offers a driver for a truck's equipment — 0524 refuses it (IV025)", () => {
    const w = drawer("move", ON_SHELF);
    expect(vm(w).tablet).toBe(false);
    expect(vm(w).holderOptions.some((o) => o.value.startsWith("driver:"))).toBe(false);
  });

  it("gives a shelved tablet to a driver: reason assigned, the driver's column and no other", async () => {
    heldBy.value = "driver";
    const w = drawer("move", ON_SHELF);
    expect(vm(w).verb).toBe("give");
    await setHolder(w, `driver:${DANA}`);
    await submit(w);
    const sent = lastSent()!;
    expect(sent).toMatchObject({ reason: "assigned", toDriverId: DANA });
    expect(sent.toLocationId).toBeNull();
    expect(sent.toVehicleId).toBeNull();
    expect(sent.toTrailerId).toBeNull();
  });

  it("offers only active and on-leave drivers — the pair IV012 admits", () => {
    heldBy.value = "driver";
    const offered = vm(drawer("move", ON_SHELF)).driverOptions.map((o) => o.value);
    expect(offered).toEqual([`driver:${DANA}`, `driver:${LEE}`]);
    expect(offered).not.toContain(`driver:${GONE}`);
  });

  it("refuses to send a give that names nobody", async () => {
    heldBy.value = "driver";
    await submit(drawer("move", ON_SHELF));
    expect(record.mutateAsync).not.toHaveBeenCalled();
  });

  it("hands one driver's tablet straight to another as a transfer, never back to the same driver", async () => {
    const w = drawer("move", WITH_DANA);
    await setVerb(w, "give");
    expect(vm(w).driverOptions.map((o) => o.value)).toEqual([`driver:${LEE}`]);
    await setHolder(w, `driver:${LEE}`);
    await submit(w);
    expect(lastSent()).toMatchObject({ reason: "transferred", toDriverId: LEE });
  });

  it("opens a driver's tablet on Return, to the shop's only bay", async () => {
    const w = drawer("move", WITH_DANA);
    expect(vm(w).verb).toBe("return");
    await submit(w);
    expect(lastSent()).toMatchObject({ reason: "removed", toLocationId: CRIB, toDriverId: null });
  });

  it("preselects no bay when the shop has two — picking one by name would be a guess", async () => {
    const two = [...LOCATIONS, { id: BENCH, name: "Bench", code: "B1", address: null, active: true }];
    const w = drawer("move", WITH_DANA, two);
    await submit(w);
    expect(lastSent()).toMatchObject({ reason: "removed", toLocationId: null, toDriverId: null });
  });
});
