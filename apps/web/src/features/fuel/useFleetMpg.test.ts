import { describe, expect, it } from "vitest";
import { unwrapFleetMpgResponse } from "./useFleetMpg";

const period = { mpg: 6.92, from: "2026-08-10", to: "2026-09-09" };

describe("unwrapFleetMpgResponse", () => {
  it("returns the fleet MPG body from the API envelope", () => {
    expect(
      unwrapFleetMpgResponse({
        ok: true,
        status: 200,
        data: { ok: true, data: period },
      }),
    ).toEqual(period);
  });

  it("preserves API failures as query errors", () => {
    expect(() =>
      unwrapFleetMpgResponse({
        ok: true,
        status: 200,
        data: { ok: false, error: { message: "MPG unavailable" } },
      }),
    ).toThrow("MPG unavailable");
  });
});
