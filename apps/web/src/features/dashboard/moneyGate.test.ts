import { describe, it, expect } from "vitest";
import { applyMoneyGate, hasMoney, type MoneyGateable } from "./moneyGate";

/**
 * LM-F / Q-LM-F1. These pin the two behaviours that are easy to get subtly wrong: a money tile with
 * an operational twin must SURVIVE as the twin, and one without a twin must DISAPPEAR rather than
 * render a dash where a figure used to be.
 */

const spend: MoneyGateable = {
  label: "Fuel spend",
  value: "$48.2k",
  valueTitle: "$48,204.19",
  sub: "Sep 1 – Sep 15",
  money: true,
};

const idle: MoneyGateable = {
  label: "Idle waste",
  value: "$8.2k",
  valueTitle: "$8,210.55",
  sub: "412 idle hrs",
  money: true,
  // The twin the tile already carried in its sub-label, promoted to the value.
  withoutMoney: { value: "412", sub: "idle hrs" },
};

const mpg: MoneyGateable = { label: "Fleet avg MPG", value: "6.4", sub: "measured miles ÷ the fuel behind them" };

describe("applyMoneyGate", () => {
  it("passes every tile through for a caller who can see accounting", () => {
    const out = applyMoneyGate([spend, idle, mpg], true);
    expect(out.map((t) => t.label)).toEqual(["Fuel spend", "Idle waste", "Fleet avg MPG"]);
    expect(out[0]!.value).toBe("$48.2k");
    expect(out[1]!.value).toBe("$8.2k");
  });

  it("never leaks the fallback as a stray prop when money IS visible", () => {
    const out = applyMoneyGate([idle], true);
    expect(out[0]).not.toHaveProperty("withoutMoney");
  });

  it("removes a money tile that has no honest non-money form", () => {
    const out = applyMoneyGate([spend, mpg], false);
    expect(out.map((t) => t.label)).toEqual(["Fleet avg MPG"]);
  });

  it("keeps a money tile that has an operational twin, showing the twin", () => {
    const out = applyMoneyGate([idle], false);
    expect(out).toHaveLength(1);
    expect(out[0]!.label).toBe("Idle waste");
    expect(out[0]!.value).toBe("412");
    expect(out[0]!.sub).toBe("idle hrs");
  });

  it("leaves no currency string anywhere in a gated strip", () => {
    const out = applyMoneyGate([spend, idle, mpg], false);
    // The blunt assertion on purpose: a `$` reaching a caller without `accounting` is the whole bug.
    expect(JSON.stringify(out)).not.toContain("$");
  });

  it("drops valueTitle with the value — the hover is money too", () => {
    // The trap this pins: blanking `value` and forgetting `valueTitle` leaves the exact figure in a
    // `title` attribute, which is worse than showing it, because nobody reviewing the screen sees it.
    const out = applyMoneyGate([idle], false);
    expect(out[0]!.valueTitle).toBeUndefined();
  });

  it("does not touch operational tiles in either direction", () => {
    expect(applyMoneyGate([mpg], false)).toEqual([mpg]);
    expect(applyMoneyGate([mpg], true)).toEqual([mpg]);
  });
});

describe("hasMoney", () => {
  it("is true when a strip still carries a currency tile", () => {
    expect(hasMoney([spend, mpg])).toBe(true);
  });
  it("is false for a purely operational strip", () => {
    expect(hasMoney([mpg])).toBe(false);
  });
});
