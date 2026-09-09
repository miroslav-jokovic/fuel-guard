import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import type { KitExpectationDto, UnitKitDto } from "@silvicom/shared";

/**
 * A unit's own kit — the override layer (INVENTORY-PLAN.md I9, D-INV12).
 *
 * ── ⚠ THE ASSERTION THIS FILE EXISTS FOR ─────────────────────────────────────────────────────
 * **Clearing a field REMOVES the override; typing 0 SETS one at zero.** Those are different answers
 * and they are the whole reason the two layers are worth having: "0" says this truck deliberately
 * carries none of a thing, and blank says "whatever the fleet says". A drawer that treated an empty
 * field as zero would silently convert "follow the fleet" into "carry none" for every row the author
 * did not touch — and no other test in this repo would fail, because the API happily stores a zero
 * and the kit screen happily renders one.
 *
 * The second one is the kind: a reefer's override must be written as a `reefer_trailer` rule, and
 * 0333's CHECK refuses one that disagrees with the unit it names — so a drawer sending the roster's
 * word would fail at the database with a constraint message.
 */

const REEFER = "33333333-3333-4333-8333-333333333333";
const BAR = "55555555-5555-4555-8555-555555555555";
const TABLET = "44444444-4444-4444-8444-444444444444";

const save = vi.hoisted(() => ({
  mutateAsync: vi.fn(async (_input: Record<string, unknown>) => ({ id: "k-1" })),
  isPending: { value: false },
}));
const remove = vi.hoisted(() => ({
  mutateAsync: vi.fn(async (_id: string) => undefined),
  isPending: { value: false },
}));
const overrides = ref<KitExpectationDto[]>([]);

vi.mock("@/features/inventory/useUnits", async () => {
  return {
    useKitExpectationsQuery: () => ({ data: overrides }),
    useSetKitExpectation: () => save,
    useDeleteKitExpectation: () => remove,
  };
});
vi.mock("@/features/inventory/useAssets", async () => {
  const { ref: r } = await import("vue");
  return {
    useAssetTypesQuery: () => ({
      data: r([
        { id: BAR, name: "Load bar", category: null, serialized: true, defaultKitQuantity: 2, imagePath: null },
        { id: TABLET, name: "Tablet", category: null, serialized: true, defaultKitQuantity: 1, imagePath: null },
      ]),
    }),
  };
});

const UnitOverrideDrawer = (await import("@/features/inventory/UnitOverrideDrawer.vue")).default;

const SlideOverStub = {
  template: "<div><slot /><slot name='footer' /></div>",
  props: ["open", "title", "size", "description"],
};

const UNIT: UnitKitDto = {
  kind: "reefer_trailer",
  unitId: REEFER,
  unitNumber: "R-8800",
  inferredDriverName: null,
  state: "short",
  shortBy: 1,
  lines: [
    { assetTypeId: BAR, assetTypeName: "Load bar", expected: 2, held: 2, delta: 0, source: "fleet" },
    { assetTypeId: TABLET, assetTypeName: "Tablet", expected: 1, held: 0, delta: -1, source: "type" },
  ],
  extraBy: 0,
};

const drawer = () =>
  mount(UnitOverrideDrawer, {
    props: { open: true, unit: UNIT, rosterKind: "trailer" } as never,
    global: { stubs: { SlideOver: SlideOverStub } },
  });

type W = ReturnType<typeof drawer>;
const submit = (w: W) => w.find("form").trigger("submit");
const type = async (w: W, label: string, value: string) => {
  const field = w.findAll("label").find((l) => l.text().startsWith(label))!;
  await w.find(`#${field.attributes("for")}`).setValue(value);
};
const sent = () => save.mutateAsync.mock.calls.map((c) => c[0]);

beforeEach(() => {
  setActivePinia(createPinia());
  save.mutateAsync.mockClear();
  remove.mutateAsync.mockClear();
  overrides.value = [];
});

describe("blank and zero are different answers", () => {
  it("writes nothing for a row left empty, whatever the kit says is in force", async () => {
    const w = drawer();
    await submit(w);
    // Both rows show a number — 2 from the fleet, 1 from the type — and neither was typed here.
    expect(save.mutateAsync).not.toHaveBeenCalled();
    expect(remove.mutateAsync).not.toHaveBeenCalled();
  });

  it("writes an override of zero when zero is typed", async () => {
    const w = drawer();
    await type(w, "Load bar", "0");
    await submit(w);
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({ assetTypeId: BAR, quantity: 0 });
  });

  it("removes the override when a set field is cleared", async () => {
    overrides.value = [
      { id: "k-9", assetTypeId: BAR, assetTypeName: "Load bar", unitKind: "reefer_trailer", vehicleId: null, trailerId: REEFER, quantity: 1 },
    ];
    const w = drawer();
    await type(w, "Load bar", "");
    await submit(w);
    expect(remove.mutateAsync).toHaveBeenCalledWith("k-9");
    expect(save.mutateAsync).not.toHaveBeenCalled();
  });

  it("leaves an override alone when its value is retyped unchanged", async () => {
    overrides.value = [
      { id: "k-9", assetTypeId: BAR, assetTypeName: "Load bar", unitKind: "reefer_trailer", vehicleId: null, trailerId: REEFER, quantity: 1 },
    ];
    const w = drawer();
    await submit(w);
    expect(save.mutateAsync).not.toHaveBeenCalled();
    expect(remove.mutateAsync).not.toHaveBeenCalled();
  });
});

describe("what the override says about the unit", () => {
  it("names the KIT kind and the unit's own column", async () => {
    const w = drawer();
    await type(w, "Tablet", "2");
    await submit(w);
    // `reefer_trailer`, not the roster's `trailer`: 0333's CHECK refuses a rule whose kind disagrees
    // with the unit it names.
    expect(sent()[0]).toMatchObject({ unitKind: "reefer_trailer", trailerId: REEFER });
    expect(sent()[0]).not.toHaveProperty("vehicleId");
  });

  it("refuses a value that is not a whole number, before it reaches the API", async () => {
    const w = drawer();
    await type(w, "Load bar", "two");
    await submit(w);
    expect(save.mutateAsync).not.toHaveBeenCalled();
  });

  it("shows where each number in force came from, so nobody retypes the fleet's answer", () => {
    const text = drawer().text();
    expect(text).toContain("Fleet default");
    expect(text).toContain("The type's own default");
  });
});
