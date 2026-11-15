import { describe, expect, it, vi } from "vitest";
import { DASHBOARD_WIDGETS } from "@silvicom/shared";
import { needsAction } from "./opsNeedsAction";

// The registry imports ten features' composables; only its KEYS are read here, so the stores and
// clients behind them are never touched.
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({}) }));

const src = (key: string, label: string, rows: Parameters<typeof needsAction>[0][number]["rows"]) => ({ key, label, rows });

describe("needsAction", () => {
  it("lists alarm rows above zero, largest first, and keeps the tab's order between equal counts", () => {
    const out = needsAction([
      src("a", "Seats", [{ key: "x", label: "X", value: 2, alarm: true }, { key: "y", label: "Y", value: 9, alarm: true }]),
      src("b", "Shop", [{ key: "z", label: "Z", value: 2, alarm: true }]),
    ]);
    expect(out.rows.map((r) => [r.key, r.value])).toEqual([["a.y", 9], ["a.x", 2], ["b.z", 2]]);
  });

  it("leaves out a row its card does not mark an alarm, however large", () => {
    const out = needsAction([src("a", "Seats", [{ key: "x", label: "X", value: 400 }, { key: "y", label: "Y", value: 1, alarm: true }])]);
    expect(out.rows.map((r) => r.key)).toEqual(["a.y"]);
    expect(out).toMatchObject({ clear: 0, unknown: 0 });
  });

  it("counts a zero as clear and an unanswered check as unknown — never one as the other", () => {
    const out = needsAction([
      src("a", "Seats", [{ key: "x", label: "X", value: 0, alarm: true }, { key: "y", label: "Y", value: null, alarm: true }]),
      src("b", "Shop", null),
    ]);
    expect(out).toEqual({ rows: [], clear: 1, unknown: 2 });
  });

  it("leaves a rate to its card", () => {
    const out = needsAction([src("a", "Roadside", [{ key: "oos", label: "OOS rate", value: 4, display: "17%", alarm: true }])]);
    expect(out).toEqual({ rows: [], clear: 0, unknown: 0 });
  });

  it("keeps the row's door and names its card in the caption", () => {
    const [row] = needsAction([src("ops.shop", "Shop", [{ key: "defects", label: "Open defects", value: 3, caption: "not resolved", to: "/shop/defects", door: "Defects", alarm: true }])]).rows;
    expect(row).toMatchObject({ key: "ops.shop.defects", caption: "Shop · not resolved", to: "/shop/defects", door: "Defects", alarm: true });
  });
});

describe("OPS_ROW_SOURCES", () => {
  it("has exactly one source per Operations card, the aggregate itself aside", async () => {
    const { OPS_ROW_SOURCES } = await import("./opsRowSources");
    const cards = DASHBOARD_WIDGETS.filter((w) => w.tab === "ops" && w.key !== "ops.needs-action").map((w) => w.key);
    expect(Object.keys(OPS_ROW_SOURCES).sort()).toEqual([...cards].sort());
  });

  it("gates the aggregate on a section a source card is gated on, so whoever gets the card gets a source", () => {
    const own = DASHBOARD_WIDGETS.find((w) => w.key === "ops.needs-action")!;
    const sources = DASHBOARD_WIDGETS.filter((w) => w.tab === "ops" && w.key !== own.key && w.module === undefined);
    expect(own.module).toBeUndefined();
    expect(sources.some((w) => JSON.stringify(w.gate) === JSON.stringify(own.gate))).toBe(true);
  });
});
