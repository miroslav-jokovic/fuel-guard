import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { answerConfirm } from "@silvicom/ui/testing";
import { ref } from "vue";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import type { AssetDto, UnitKitDto } from "@silvicom/shared";

/**
 * A truck's kit, walked on a phone (INVENTORY-PLAN.md I9; D-INV19, D-INV24, D-INV27).
 *
 * ── THE THREE THINGS THIS SCREEN CAN GET WRONG THAT NOTHING ELSE WOULD CATCH ──────────────────
 *
 *   1. **"Not here" must be a REPORT, never a removal.** Clearing the holder would make the truck
 *      read correctly and destroy the only fact that explains the gap — an asset with no holder
 *      cannot say which truck it went missing from, and "654 is missing its fridge" is the whole
 *      output of a kit check. `reported_missing` carries no destination, and 0333's CHECK refuses
 *      one that does.
 *   2. **Confirming what the system already believes writes NOTHING.** A ledger row per confirmed
 *      strap would bury the two rows that mean something, and would make an eight-item check
 *      indistinguishable from eight moves.
 *   3. **The write reaches the phone before the network.** The same promise the shelf walk makes,
 *      now shared through `useWalk` — a bay is where the signal is worst, and a check that sent
 *      first would lose the last four items behind a container.
 */

const SESSION = "44444444-4444-4444-8444-444444444444";
const TRUCK = "11111111-1111-4111-8111-111111111111";
const TABLET = "22222222-2222-4222-8222-222222222222";
const ELSEWHERE = "66666666-6666-4666-8666-666666666666";
/** ⚠ A real uuid: `assetMovementInputSchema.assetId` is `recordId()`, so a short stub like "as-01" is
 *  refused at the edge — and the screen would then record nothing for a reason that is the
 *  fixture's, not the code's. `MovementDrawer.test.ts` carries the same note. */
const ON_UNIT = "77777777-7777-4777-8777-777777777777";
const STRAP = "88888888-8888-4888-8888-888888888888";
const ON_702 = "99999999-9999-4999-8999-999999999999";
/** EA3: what `/api/tags/resolve` answers, by code. */
const resolved = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/features/inventory/useScan", () => ({
  resolveScanCode: async (code: string) => resolved.get(code) ?? { kind: "malformed", code },
}));

const asset = (id: string, over: Partial<AssetDto> = {}): AssetDto => ({
  id,
  tagCode: null,
  displayNo: `A-04${id.slice(-2)}`,
  assetTypeId: TABLET,
  assetTypeName: "Tablet",
  name: "Cab tablet",
  serialNumber: null,
  imei: null,
  model: null,
  manufacturer: null,
  status: "in_service",
  condition: "good",
  holder: { kind: "vehicle", id: TRUCK, label: "654", inferredDriverName: null, since: null },
  purchasedAt: null,
  purchaseCost: null,
  warrantyExpiresAt: null,
  imagePath: null,
  notes: null,
  ...over,
});

const unit: UnitKitDto = {
  kind: "tractor",
  unitId: TRUCK,
  unitNumber: "654",
  inferredDriverName: null,
  state: "short",
  shortBy: 1,
  extraBy: 0,
  lastCheckedAt: null,
  lines: [{ assetTypeId: TABLET, assetTypeName: "Tablet", heldBy: "driver", expected: 2, held: 1, delta: -1, source: "fleet" }],
};

const walk = ref<Record<string, unknown> | undefined>({
  id: SESSION,
  kind: "unit",
  locationId: null,
  vehicleId: TRUCK,
  trailerId: null,
  holderLabel: "654",
  startedBy: "u-1",
  startedByName: "Shop Lead",
  blind: false,
  status: "open",
  openedAt: "2026-09-09T10:00:00.000Z",
  closedAt: null,
  note: null,
});

const kit = ref<{ unit: UnitKitDto; assets: AssetDto[] }>({ unit, assets: [asset(ON_UNIT)] });
const move = vi.hoisted(() => ({
  mutateAsync: vi.fn(async (_m: Record<string, unknown>) => ({ id: "m-1" })),
  isPending: { value: false },
}));
const closeWalk = vi.hoisted(() => ({ mutateAsync: vi.fn(async () => ({})), isPending: { value: false } }));
/** D-US5: the kit read can fail; `refetch` is what the page's Retry must call. */
const kitRead = vi.hoisted(() => ({ fails: false, refetch: vi.fn() }));

vi.mock("@/features/inventory/useInventory", async () => {
  const { ref: r } = await import("vue");
  return {
    useCountSessionQuery: () => ({ data: walk, isLoading: r(false), isError: r(false), error: r(null), isFetching: r(false), refetch: vi.fn() }),
    useCloseCountSession: () => closeWalk,
  };
});
vi.mock("@/features/inventory/useUnits", async () => {
  const { ref: r } = await import("vue");
  return {
    useUnitKitQuery: () => ({
      data: kit, isLoading: r(false), isError: r(kitRead.fails), error: r(kitRead.fails ? new Error("boom") : null),
      isFetching: r(false), refetch: kitRead.refetch,
    }),
  };
});
vi.mock("@/features/inventory/useAssets", async () => {
  const { ref: r } = await import("vue");
  return {
    useAssetsQuery: () => ({ data: r({ assets: [asset(ELSEWHERE, { holder: { kind: "location", id: "loc", label: "Tool crib", inferredDriverName: null, since: null } })], total: 1 }) }),
    useMoveAsset: () => move,
    // EA3: the scan's judgement reads the types; a strap here is a truck's thing.
    useAssetTypesQuery: () => ({ data: r([{ id: STRAP, name: "Strap", category: null, serialized: false, defaultKitQuantity: 0, imagePath: null, heldBy: "unit" }]) }),
  };
});
vi.mock("vue-router", async (importOriginal) => ({
  // SP5: `useOpens()` resolves links against the route table with the REAL router factory, so the
  // three names it takes from vue-router stay real under this mock.
  ...(({ routerKey, createRouter, createMemoryHistory }) => ({ routerKey, createRouter, createMemoryHistory }))(
    await importOriginal<typeof import("vue-router")>(),
  ),
  useRoute: () => ({ params: { sessionId: SESSION }, path: `/shop/count/${SESSION}`, meta: { title: "Count" } }),
  useRouter: () => ({ push: vi.fn(), resolve: () => ({ name: "not-found", meta: {} }) }),
}));

const { pending } = await import("@/features/inventory/countQueue");
const UnitCheck = (await import("@/features/inventory/UnitCheck.vue")).default;

const page = () => mount(UnitCheck, { attachTo: document.body, global: { stubs: { Teleport: true } } });
type W = ReturnType<typeof page>;

/**
 * ⚠ `flushPromises` alone is not enough. Recording an answer writes to IndexedDB before it touches
 * the network, and IndexedDB delivers its events as MACROTASKS — a helper that drains only
 * microtasks returns mid-write. `CountSessionPage.test.ts` records the same finding against the
 * shelf walk, and the two screens share the queue that causes it.
 */
const settle = async () => {
  for (let i = 0; i < 5; i += 1) {
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await flushPromises();
};

const press = async (w: W, label: string) => {
  const button = w.findAll("button").find((b) => b.text() === label);
  expect(button, `no button labelled "${label}"`).toBeTruthy();
  await button!.trigger("click");
  await settle();
};

beforeEach(() => {
  setActivePinia(createPinia());
  globalThis.indexedDB = new IDBFactory();
  document.body.innerHTML = "";
  // `mockReset`, not `mockClear`: a previous test's rejection is an IMPLEMENTATION, and clearing
  // only the call log leaves it in place for the next test to trip over.
  move.mutateAsync.mockReset();
  move.mutateAsync.mockImplementation(async () => ({ id: "m-1" }));
  closeWalk.mutateAsync.mockClear();
  kit.value = { unit, assets: [asset(ON_UNIT)] };
  kitRead.fails = false;
  kitRead.refetch.mockClear();
  resolved.clear();
});

/** The Tera Pro: a burst of keydowns on the document and an Enter, as `useScanInput` reads it. */
async function scan(code: string) {
  for (const key of code) document.dispatchEvent(new KeyboardEvent("keydown", { key }));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  await settle();
}

/** D-INV17 as amended 2026-09-10: the check is a page in the app's own shell, titled like the unit's page. */
describe("the page's anatomy", () => {
  it("titles the page the way the unit's own page does, and describes it with the progress", () => {
    const w = page();
    expect(w.find("h1").text()).toBe("Truck 654");
    expect(w.text()).toContain("0 of 1 checked");
  });
});

describe("a kit that fails to load (D-US5)", () => {
  it("says so with a Retry, instead of claiming every item has been looked at", async () => {
    kitRead.fails = true;
    const w = page();
    expect(w.text()).not.toContain("Every item has been looked at");
    expect(w.get("[role=alert]").text()).toContain("Could not load the list.");
    await press(w, "Retry");
    expect(kitRead.refetch).toHaveBeenCalledTimes(1);
  });
});

describe("what each answer writes", () => {
  it("writes NOTHING when the thing is where the system says it is", async () => {
    const w = page();
    await press(w, "It's here");
    expect(move.mutateAsync).not.toHaveBeenCalled();
    // …and the walk has moved on, so the answer was recorded locally.
    expect(w.text()).toContain("Every item has been looked at");
  });

  /**
   * The assertion this file exists for. `reported_missing` leaves the holder exactly where it was —
   * a fridge missing from 654 is still 654's fridge — so the payload must name no destination at
   * all. Asserted on what was SENT, because zod strips unknown keys: a shape assertion would pass
   * against a screen that bound a destination and let the schema drop it.
   */
  it("reports a missing item without moving it", async () => {
    const w = page();
    await press(w, "Not here");
    expect(move.mutateAsync).toHaveBeenCalledTimes(1);
    const sent = move.mutateAsync.mock.calls[0]![0];
    expect(sent).toMatchObject({ assetId: ON_UNIT, reason: "reported_missing", countSessionId: SESSION });
    expect(sent.toVehicleId).toBeUndefined();
    expect(sent.toLocationId).toBeUndefined();
    expect(sent.toTrailerId).toBeUndefined();
  });

  it("moves a thing that turns up onto this unit, and says where it came from", async () => {
    const w = page();
    await press(w, "It's here");
    // The shortfall's one-tap, labelled differently from the item card's answer on purpose — a real
    // render carried "It's here" twice on one screen meaning two different things.
    await press(w, "One turned up");
    await press(w, `A-04${ELSEWHERE.slice(-2)} — Tool crib`);
    const sent = move.mutateAsync.mock.calls.at(-1)![0];
    expect(sent).toMatchObject({ assetId: ELSEWHERE, reason: "found", toVehicleId: TRUCK });
  });
});

describe("the promise the queue keeps", () => {
  it("writes the answer to this phone BEFORE the network is touched", async () => {
    // The network refuses, exactly as a bay does. The row must still be on the phone.
    move.mutateAsync.mockRejectedValue(new Error("offline"));
    const w = page();
    await press(w, "Not here");
    const queued = await pending(SESSION);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.kind).toBe("asset");
  });

  it("...and drops it once the server has it", async () => {
    const w = page();
    await press(w, "Not here");
    expect(await pending(SESSION)).toHaveLength(0);
  });
});

describe("scanning (EA3)", () => {
  it("ticks off what this unit holds and writes nothing for it", async () => {
    resolved.set("SIL1:AST:ONUNIT", { kind: "asset", code: "SIL1:AST:ONUNIT", asset: asset(ON_UNIT) });
    const w = page();
    await scan("SIL1:AST:ONUNIT");
    expect(w.text()).toContain("1 of 1 checked");
    expect(w.find("[data-test=check-last-scan]").text()).toContain("here");
    expect(move.mutateAsync).not.toHaveBeenCalled();
  });

  // D-DE4: a truck's check lists its driver's tablet, held by the DRIVER — the scan must tick it, not
  // judge it as "a tablet goes to a driver", which is what the Assign list would say about it.
  it("ticks off the truck's driver's tablet, which the driver holds", async () => {
    const tablet = asset(ON_UNIT, { holder: { kind: "driver", id: "d-1", label: "Dana Reyes", inferredDriverName: null, since: null } });
    kit.value = { unit, assets: [tablet] };
    resolved.set("SIL1:AST:TABLET", { kind: "asset", code: "SIL1:AST:TABLET", asset: tablet });
    const w = page();
    await scan("SIL1:AST:TABLET");
    expect(w.text()).toContain("1 of 1 checked");
  });

  it("says where a thing recorded elsewhere is, and Move it here writes the `found` move", async () => {
    const strap = asset(ON_702, { assetTypeId: STRAP, assetTypeName: "Strap", name: "Strap 9", holder: { kind: "vehicle", id: "v-702", label: "Truck 702", inferredDriverName: null, since: null } });
    resolved.set("SIL1:AST:ON702A", { kind: "asset", code: "SIL1:AST:ON702A", asset: strap });
    const w = page();
    await scan("SIL1:AST:ON702A");
    expect(w.find("[data-test=check-last-scan]").text()).toContain("is recorded on Truck 702");
    await w.find("[data-test=check-move-here]").trigger("click");
    await settle();
    expect(move.mutateAsync.mock.calls.at(-1)![0]).toMatchObject({ assetId: ON_702, reason: "found", toVehicleId: TRUCK, countSessionId: SESSION });
  });

  it("says what a label is when it is nothing this check can tick", async () => {
    resolved.set("012345678905", { kind: "part_by_upc", code: "012345678905", part: {}, stockLines: [] });
    const w = page();
    await scan("012345678905");
    expect(w.find("[data-test=check-last-scan]").text()).toBe("That is a shop part, not equipment.");
    expect(w.find("[data-test=check-move-here]").exists()).toBe(false);
  });
});

describe("closing", () => {
  /** EA3: what nobody scanned or ticked is reported not found on the way out — and the dialog says so first. */
  it("names how many will be reported not found, and writes nothing when cancelled", async () => {
    const asked = answerConfirm(false);
    const w = page();
    await press(w, "Review");
    await press(w, "Close the check");
    // D-US7: the product's dialog, red because closing cannot be undone.
    expect(asked).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Report 1 not found and close?",
        confirmLabel: "Report and close",
        tone: "danger",
      }),
    );
    expect(closeWalk.mutateAsync).not.toHaveBeenCalled();
    expect(move.mutateAsync).not.toHaveBeenCalled();
  });

  it("reports what was not looked at as missing — never a move — then closes", async () => {
    answerConfirm(true);
    const w = page();
    await press(w, "Review");
    await press(w, "Close the check");
    expect(move.mutateAsync).toHaveBeenCalledTimes(1);
    const sent = move.mutateAsync.mock.calls[0]![0];
    expect(sent).toMatchObject({ assetId: ON_UNIT, reason: "reported_missing", countSessionId: SESSION });
    expect(sent.toVehicleId).toBeUndefined();
    expect(closeWalk.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("reports nothing when everything was looked at", async () => {
    answerConfirm(true);
    const w = page();
    await press(w, "It's here");
    await press(w, "Review and close");
    await press(w, "Close the check");
    expect(move.mutateAsync).not.toHaveBeenCalled();
    expect(closeWalk.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("shows what is short at review, which is what somebody acts on", async () => {
    const w = page();
    await press(w, "Review");
    expect(w.text()).toContain("Short");
    expect(w.text()).toContain("Unchecked");
  });
});
