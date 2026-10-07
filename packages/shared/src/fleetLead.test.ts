import { describe, expect, it } from "vitest";
import { periodDelta } from "./dashboardComparison.js";
import { FLEET_LEAD_DEFAULT, fleetLead } from "./fleetLead.js";

const against = "the previous 31 days";

describe("fleetLead", () => {
  it("keeps the static line until there is a comparison to speak about", () => {
    expect(fleetLead({ spend: null, mpg: null, idleHours: null, waiting: 3, against })).toBe(FLEET_LEAD_DEFAULT);
    const flat = periodDelta(100, 100);
    expect(fleetLead({ spend: flat, mpg: flat, idleHours: flat, waiting: 3, against })).toBe(FLEET_LEAD_DEFAULT);
  });

  it("names the largest movement by percent, in words, then what is waiting", () => {
    expect(
      fleetLead({ spend: periodDelta(1_120, 1_000), mpg: periodDelta(7.72, 7.42), idleHours: periodDelta(950, 1_000), waiting: 2, against }),
    ).toBe("Fuel spend is running 12% ahead of the previous 31 days. 2 things need a decision today.");
  });

  it("lets idle hours lead when they moved the most, and counts one thing in words", () => {
    expect(
      fleetLead({ spend: periodDelta(1_010, 1_000), mpg: null, idleHours: periodDelta(820, 1_000), waiting: 1, against }),
    ).toBe("Idle hours are down 18% on the previous 31 days. One thing needs a decision today.");
  });

  it("speaks MPG in its own unit, and says plainly when nothing is waiting", () => {
    expect(fleetLead({ spend: null, mpg: periodDelta(7.72, 7.42), idleHours: null, waiting: 0, against })).toBe(
      "Fleet MPG is up 0.3 on the previous 31 days. Nothing is waiting on you.",
    );
  });

  it("says spend is down, not 'running behind'", () => {
    expect(fleetLead({ spend: periodDelta(900, 1_000), mpg: null, idleHours: null, waiting: 0, against })).toMatch(/^Fuel spend is down 10% on/);
  });
});
