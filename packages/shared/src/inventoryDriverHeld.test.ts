import { describe, expect, it } from "vitest";
import { DRIVER_LEFT_STATUSES, DRIVER_STATUSES_THAT_TAKE_A_TABLET, driverHasLeft } from "./inventoryDriverHeld.js";

describe("who a tablet may be given to (DE2b)", () => {
  it("is the active and on-leave drivers — 0524's IV012 pair, no applicant and nobody who has left", () => {
    expect([...DRIVER_STATUSES_THAT_TAKE_A_TABLET].sort()).toEqual(["active", "on_leave"]);
  });

  it("never overlaps the statuses that flag a tablet as not returned", () => {
    for (const s of DRIVER_STATUSES_THAT_TAKE_A_TABLET) expect(driverHasLeft(s)).toBe(false);
    for (const s of DRIVER_LEFT_STATUSES) expect(DRIVER_STATUSES_THAT_TAKE_A_TABLET).not.toContain(s);
  });
});
