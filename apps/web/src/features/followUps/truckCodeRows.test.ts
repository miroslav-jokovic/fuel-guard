import { describe, expect, it } from "vitest";
import type { TruckFaultCode } from "@silvicom/shared";
import { codeDetail, codeNumbers, codeTitle, lampsSentence, splitCodes } from "./truckCodeRows";

const code = (over: Partial<TruckFaultCode> = {}): TruckFaultCode => ({
  module: 1, moduleName: "Engine #2", spn: 1636, fmi: 3, description: "Engine Intake Manifold 1 Temperature (High Resolution)",
  fmiDescription: "Voltage Above Normal", makerSpecific: false, occurrences: 3, ...over,
});

describe("truck code words", () => {
  it("names the lamps that are on, red first, and says when none is", () => {
    expect(lampsSentence({ stop: true, warning: false, emissions: true, protect: false })).toBe("Lamps on: red STOP, emissions.");
    expect(lampsSentence({ stop: false, warning: false, emissions: false, protect: false })).toBe("No dash lamps on.");
    expect(lampsSentence(null)).toBeNull();
  });

  it("reads a code as Samsara's words first and the shop's two numbers after", () => {
    expect(codeTitle(code())).toBe("Engine Intake Manifold 1 Temperature (High Resolution)");
    expect(codeNumbers(code())).toBe("SPN 1636 · FMI 3");
    expect(codeDetail(code())).toBe("Voltage Above Normal · Engine #2 · 3 times");
  });

  it("says a maker-specific code is the shop's to look up, instead of Samsara's placeholder", () => {
    expect(codeTitle(code({ description: null, makerSpecific: true }))).toBe("Maker-specific code — the shop looks it up by its SPN");
    expect(codeTitle(code({ description: null }))).toBe("Samsara has no description for this code");
    expect(codeNumbers(code({ fmi: null }))).toBe("SPN 1636");
    expect(codeDetail(code({ fmiDescription: null, occurrences: 1 }))).toBe("Engine #2");
  });

  it("folds the camera, radar and telematics codes beneath the truck's own", () => {
    const out = splitCodes([code({ module: 232 }), code({ module: 0 }), code({ module: 74 }), code({ module: null })]);
    expect([out.vehicle.map((c) => c.module), out.electronics.map((c) => c.module)]).toEqual([[0, null], [232, 74]]);
  });
});
