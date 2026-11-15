import { describe, expect, it } from "vitest";
import { DASHBOARD_WIDGETS } from "@silvicom/shared";
import { packedSpanOf } from "./packing";

const tab = (key: string) => DASHBOARD_WIDGETS.filter((w) => w.tab === key);

describe("packedSpanOf", () => {
  it("packs Operations, whose cards all take one span, and grids Fleet overview, whose cards differ", () => {
    expect(packedSpanOf(tab("ops"))).toBe(4);
    expect(packedSpanOf(tab("fleet"))).toBeNull();
  });

  it("decides from the spans in front of it, so an arrangement of equal cards packs too", () => {
    expect(packedSpanOf([{ span: 6 }, { span: 6 }])).toBe(6);
    expect(packedSpanOf([{ span: 6 }, { span: 4 }])).toBeNull();
  });

  it("leaves a lone card, a full-width card and a workspace on the grid", () => {
    expect(packedSpanOf([{ span: 4 }])).toBeNull();
    expect(packedSpanOf([{ span: 12 }, { span: 12 }])).toBeNull();
    expect(packedSpanOf([{ span: "workspace" }, { span: "workspace" }])).toBeNull();
    expect(packedSpanOf([])).toBeNull();
  });
});
