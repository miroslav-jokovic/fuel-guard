import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import type { AssetDto, AssetTypeDto, ScanResult } from "@silvicom/shared";

/**
 * Assign equipment (EA1). What this file pins that `assignLine.test.ts` cannot:
 *
 * 1. **The scanner fills the list.** A Tera Pro burst on the document adds a line; the same label
 *    twice is one line, and the same item by a second code (its IMEI) is one line too.
 * 2. **Confirm sends only what the lines said it would**, one `move_asset` per assignable line, each
 *    to the column of its own holder — including a line sent to the truck's driver instead.
 * 3. **The movement id is the LINE's (D-INV27).** A Confirm that half-fails and is pressed again
 *    re-sends the failed line with the id it was given when it was scanned, and does not re-send the
 *    line that already landed.
 */

const TRUCK = "44444444-4444-4444-8444-444444444444";
const DANA = "66666666-6666-4666-8666-666666666666";
const TABLET_TYPE = "33333333-3333-4333-8333-333333333333";
const STRAP_TYPE = "22222222-2222-4222-8222-222222222222";

const record = vi.hoisted(() => ({ mutateAsync: vi.fn(async (_i: Record<string, unknown>) => ({ id: "m" })) }));
const answers = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/features/inventory/useScan", () => ({
  resolveScanCode: vi.fn(async (code: string) => answers.get(code) ?? { kind: "malformed", code }),
}));
vi.mock("@/features/inventory/useAssets", () => ({
  useMoveAsset: () => record,
  useAssetTypesQuery: () => ({
    data: ref<AssetTypeDto[]>([
      { id: TABLET_TYPE, name: "Tablet", category: null, serialized: true, defaultKitQuantity: 0, imagePath: null, heldBy: "driver" },
      { id: STRAP_TYPE, name: "Ratchet strap", category: null, serialized: false, defaultKitQuantity: 0, imagePath: null, heldBy: "unit" },
    ]),
  }),
}));
vi.mock("@/composables/useVehicles", () => ({
  useVehiclesQuery: () => ({ data: ref([{ id: TRUCK, unit_number: "654", assigned_driver_id: DANA, co_driver_id: null }]) }),
}));
vi.mock("@/composables/useDrivers", () => ({ useDriversQuery: () => ({ data: ref([{ id: DANA, full_name: "Dana Reyes" }]) }) }));

const AssignEquipmentDrawer = (await import("./AssignEquipmentDrawer.vue")).default;
const SlideOverStub = { template: "<div><slot /><slot name='footer' /></div>", props: ["open", "title", "size"] };

function asset(id: string, displayNo: string, typeId: string, typeName: string): AssetDto {
  return {
    id, tagCode: null, displayNo, assetTypeId: typeId, assetTypeName: typeName, name: `${typeName} ${displayNo}`,
    serialNumber: null, imei: null, model: null, manufacturer: null, status: "in_service", condition: "good",
    holder: { kind: "location", id: "bay", label: "Shop", inferredDriverName: null, since: null },
    purchasedAt: null, purchaseCost: null, warrantyExpiresAt: null, purchaseId: null, imagePath: null, notes: null,
  };
}
const STRAP_A = asset("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "A-0001", STRAP_TYPE, "Ratchet strap");
const STRAP_B = asset("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "A-0002", STRAP_TYPE, "Ratchet strap");
const TABLET = asset("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "A-0003", TABLET_TYPE, "Tablet");
const hit = (code: string, a: AssetDto): ScanResult => ({ kind: "asset", code, asset: a });

const target = { kind: "vehicle", id: TRUCK, label: "Truck 654" } as const;
const drawer = () =>
  mount(AssignEquipmentDrawer, {
    props: { open: true, target },
    global: { stubs: { SlideOver: SlideOverStub, BarcodeCamera: true, AssetDrawer: true } },
    attachTo: document.body,
  });
type W = ReturnType<typeof drawer>;

/** The Tera Pro: a burst of keydowns on the document and an Enter, as `useScanInput` reads it. */
async function scan(code: string) {
  for (const key of code) document.dispatchEvent(new KeyboardEvent("keydown", { key }));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  await flushPromises();
}
const lines = (w: W) => w.findAll("[data-test=assign-line]").map((l) => l.text());
const sent = () => record.mutateAsync.mock.calls.map((c) => c[0] as Record<string, unknown>);

beforeEach(() => {
  setActivePinia(createPinia());
  document.body.innerHTML = "";
  record.mutateAsync.mockReset();
  record.mutateAsync.mockImplementation(async () => ({ id: "m" }));
  answers.clear();
  answers.set("SIL1:AST:AAAAAA", hit("SIL1:AST:AAAAAA", STRAP_A));
  answers.set("SIL1:AST:BBBBBB", hit("SIL1:AST:BBBBBB", STRAP_B));
  answers.set("A-0001", hit("A-0001", STRAP_A));
  answers.set("SIL1:AST:CCCCCC", hit("SIL1:AST:CCCCCC", TABLET));
});

describe("scanning onto a truck's list", () => {
  it("adds a line per scan and says what Confirm will do", async () => {
    const w = drawer();
    await scan("SIL1:AST:AAAAAA");
    await scan("SIL1:AST:BBBBBB");
    expect(lines(w)).toHaveLength(2);
    expect(lines(w)[0]).toContain("Goes on Truck 654");
    expect(w.find("[data-test=assign-confirm]").text()).toBe("Assign 2");
    w.unmount();
  });

  it("keeps one line for one item, whichever of its codes was scanned", async () => {
    const w = drawer();
    await scan("SIL1:AST:AAAAAA");
    await scan("A-0001");
    expect(lines(w)).toHaveLength(1);
    w.unmount();
  });

  it("refuses a tablet on the line, and Give to the driver instead sends it to the driver", async () => {
    const w = drawer();
    await scan("SIL1:AST:CCCCCC");
    expect(lines(w)[0]).toContain("A tablet goes to a driver, not on a truck.");
    expect(w.find("[data-test=assign-confirm]").attributes("disabled")).toBeDefined();
    await w.find("[data-test=assign-instead]").trigger("click");
    expect(lines(w)[0]).toContain("Goes to Dana Reyes");
    await w.find("form").trigger("submit");
    await flushPromises();
    expect(sent()).toEqual([expect.objectContaining({ assetId: TABLET.id, toDriverId: DANA, toVehicleId: null, reason: "assigned" })]);
    w.unmount();
  });

  it("offers Add it for a tablet's IMEI that nothing carries", async () => {
    const w = drawer();
    await scan("490154203237518");
    expect(lines(w)[0]).toContain("A tablet not on file yet.");
    expect(w.find("[data-test=assign-add]").exists()).toBe(true);
    w.unmount();
  });
});

describe("Confirm (D-INV27)", () => {
  it("sends each assignable line to the truck, and re-sends only the failed one with ITS id", async () => {
    const w = drawer();
    await scan("SIL1:AST:AAAAAA");
    await scan("SIL1:AST:BBBBBB");
    record.mutateAsync.mockImplementation(async (input) => {
      if (input.assetId === STRAP_A.id) throw new Error("That bay, truck, trailer or driver is not available");
      return { id: "m" };
    });
    await w.find("form").trigger("submit");
    await flushPromises();
    const first = sent();
    expect(first).toHaveLength(2);
    expect(first.every((m) => m.toVehicleId === TRUCK && m.toDriverId === null)).toBe(true);
    expect(lines(w).join(" ")).toContain("not available");

    record.mutateAsync.mockImplementation(async () => ({ id: "m" }));
    await w.find("form").trigger("submit");
    await flushPromises();
    const retry = sent().slice(2);
    expect(retry).toHaveLength(1);
    expect(retry[0]!.assetId).toBe(STRAP_A.id);
    expect(retry[0]!.id).toBe(first.find((m) => m.assetId === STRAP_A.id)!.id);
    expect(retry[0]!.occurredAt).toBe(first[0]!.occurredAt);
    expect(w.emitted("close")).toBeTruthy();
    w.unmount();
  });
});

describe("scanning another unit's own label moves the list on (DE5)", () => {
  const TRAILER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  beforeEach(() => {
    answers.set("SIL1:TRL:X4Q2VW", { kind: "unit", code: "SIL1:TRL:X4Q2VW", unit: { kind: "trailer", id: TRAILER, unitNumber: "1203" } });
    answers.set("SIL1:VEH:7K3M9P", { kind: "unit", code: "SIL1:VEH:7K3M9P", unit: { kind: "vehicle", id: TRUCK, unitNumber: "654" } });
  });

  it("says so, keeps what was scanned going where it was going, and sends each to its own unit", async () => {
    const w = drawer();
    await scan("SIL1:AST:AAAAAA");
    await scan("SIL1:TRL:X4Q2VW");
    expect(w.get("[data-test=assign-switched]").text()).toContain("Now assigning to Trailer 1203");
    // The label is not a line, and the strap scanned for 654 still goes on 654.
    expect(lines(w)).toHaveLength(1);
    expect(lines(w)[0]).toContain("Goes on Truck 654");
    await scan("SIL1:AST:BBBBBB");
    expect(lines(w)[0]).toContain("Goes on Trailer 1203");
    await w.find("form").trigger("submit");
    await flushPromises();
    // Newest line first, as the list shows them.
    expect(sent()).toEqual([
      expect.objectContaining({ assetId: STRAP_B.id, toTrailerId: TRAILER, toVehicleId: null }),
      expect.objectContaining({ assetId: STRAP_A.id, toVehicleId: TRUCK, toTrailerId: null }),
    ]);
    w.unmount();
  });

  it("keeps a tablet's offer to give it to 654's driver after the list has moved to a trailer", async () => {
    const w = drawer();
    await scan("SIL1:AST:CCCCCC");
    await scan("SIL1:TRL:X4Q2VW");
    expect(w.find("[data-test=assign-instead]").text()).toBe("Give to Dana Reyes instead");
    w.unmount();
  });

  it("does nothing for the truck's own label but say so", async () => {
    const w = drawer();
    await scan("SIL1:VEH:7K3M9P");
    expect(w.find("[data-test=assign-switched]").exists()).toBe(false);
    expect(lines(w)[0]).toContain("That is Truck 654's own label.");
    w.unmount();
  });
});
