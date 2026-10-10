import { describe, it, expect } from "vitest";
import { nextTick, ref } from "vue";
import type { DispatchBoardRow } from "@silvicom/shared";
import { NO_FLEET_OPTION, POOL_OPTION, admitsScope, useScopeChoice, type ScopedItem } from "./dispatchScope";
import { loadsOnBoard } from "./loadsOnBoard";

/**
 * The scope both dispatch pages share (DISPATCH-BOARD-PLAN §5.3, DB5b). The board's own filter tests
 * (`dispatchBoardView.test.ts`) cover it over truck rows; these pin the rule itself, the part the Loads
 * page leans on — a load with no fleet of its own is still "mine" when I dispatch it — and the join
 * that gives a load its truck's fleet and the board's verdict.
 */
const scope = { linked: true, fleetCodes: ["VINNIEV"], dispatcherIds: ["vinniev"] };
const none = { mine: false, fleet: "", dispatcher: "" };
const item = (fleetCode: string | null, dispatcherId: string | null, next: string | null = null): ScopedItem => ({
  fleetCode,
  current: { dispatcherId },
  next: next ? { dispatcherId: next } : null,
});

describe("admitsScope", () => {
  it("counts as mine a truck in my fleet, or a load I dispatch on anyone's truck — and nothing else", () => {
    const mine = { ...none, mine: true };
    expect(admitsScope(item("VINNIEV", "asen"), scope, mine)).toBe(true);
    expect(admitsScope(item("VLADI", "vinniev"), scope, mine)).toBe(true);
    expect(admitsScope(item(null, "vinniev"), scope, mine)).toBe(true);
    expect(admitsScope(item("VLADI", "asen"), scope, mine)).toBe(false);
    expect(admitsScope(item(null, null), scope, mine)).toBe(false);
  });

  it("narrows by fleet, by the parked pool, and by no fleet at all", () => {
    expect(admitsScope(item("VLADI", null), scope, { ...none, fleet: "VLADI" })).toBe(true);
    expect(admitsScope(item("VINNIEV", null), scope, { ...none, fleet: "VLADI" })).toBe(false);
    expect(admitsScope(item("1", null), scope, { ...none, fleet: POOL_OPTION })).toBe(true);
    expect(admitsScope(item("VLADI", null), scope, { ...none, fleet: POOL_OPTION })).toBe(false);
    expect(admitsScope(item(null, null), scope, { ...none, fleet: NO_FLEET_OPTION })).toBe(true);
    expect(admitsScope(item("VLADI", null), scope, { ...none, fleet: NO_FLEET_OPTION })).toBe(false);
  });

  it("matches Dispatched by on the current OR the next load", () => {
    expect(admitsScope(item("VLADI", "asen"), scope, { ...none, dispatcher: "asen" })).toBe(true);
    expect(admitsScope(item("VLADI", "ivok", "asen"), scope, { ...none, dispatcher: "asen" })).toBe(true);
    expect(admitsScope(item("VLADI", "ivok"), scope, { ...none, dispatcher: "asen" })).toBe(false);
  });
});

describe("useScopeChoice", () => {
  it("follows whether the caller is linked until they choose, and never after", async () => {
    const linked = ref(false);
    const { choice, choose } = useScopeChoice(linked);
    expect(choice.value).toBe("all");
    linked.value = true;
    await nextTick();
    expect(choice.value).toBe("mine");
    choose("all");
    linked.value = false;
    await nextTick();
    linked.value = true;
    await nextTick();
    expect(choice.value).toBe("all");
  });

  it("takes a link's scope=all as a choice already made, and ignores anything else in the URL", async () => {
    const linked = ref(true);
    expect(useScopeChoice(linked, "all").choice.value).toBe("all");
    expect(useScopeChoice(linked, "nonsense").choice.value).toBe("mine");
  });
});

describe("loadsOnBoard", () => {
  const row = (vehicleId: string, fleetCode: string | null, loadId: string | null, onTime: DispatchBoardRow["onTime"]) =>
    ({ vehicleId, fleetCode, current: loadId ? { loadId } : null, onTime }) as unknown as DispatchBoardRow;
  const board = { rows: [row("v-773", "VINNIEV", "L-1", "late"), row("v-801", null, null, "unknown")] };

  it("gives a load its truck's fleet and its own dispatcher", () => {
    const on = loadsOnBoard(board);
    expect(on.scopeItem({ vehicle_id: "v-773", dispatcher_external_id: "asen" })).toEqual({
      fleetCode: "VINNIEV",
      current: { dispatcherId: "asen" },
      next: null,
    });
    expect(on.scopeItem({ vehicle_id: null }).fleetCode).toBeNull();
    expect(on.scopeItem({ vehicle_id: "v-gone" }).fleetCode).toBeNull();
  });

  it("reads the board's verdict only for a load a truck is hauling now", () => {
    const on = loadsOnBoard(board);
    expect(on.onTimeOf("L-1")).toBe("late");
    expect(on.onTimeOf("L-upcoming")).toBeNull();
    expect(loadsOnBoard(null).onTimeOf("L-1")).toBeNull();
  });
});
