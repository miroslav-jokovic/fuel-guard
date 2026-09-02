import { describe, it, expect } from "vitest";
import { efsRejectDayWindow } from "./stationTime";

/**
 * The reject window is Central-time days expressed as UTC instants (FUEL-T1, D-FUI11).
 *
 * A decline at 19:00 Central on 31 August is 2026-09-01T00:00Z — so an instant window built from the
 * bare date strings put it in September while the page, which renders declines in Central with a "CT"
 * label, showed it as 31 August. Same defect as the fills' one, different zone, and no column needed
 * because Central does not vary row to row.
 */
describe("efsRejectDayWindow", () => {
  it("starts at Central midnight, not UTC midnight", () => {
    // CDT is UTC−5 in August, so 1 Aug 00:00 CT is 1 Aug 05:00Z.
    expect(efsRejectDayWindow("2026-08-01", "2026-08-31").gte).toBe("2026-08-01T05:00:00.000Z");
  });

  it("ends at the START of the day after — half-open, so no second is dropped", () => {
    // 1 Sep 00:00 CT = 1 Sep 05:00Z. An inclusive `23:59:59` bound would lose the final second.
    expect(efsRejectDayWindow("2026-08-01", "2026-08-31").lt).toBe("2026-09-01T05:00:00.000Z");
  });

  it("puts a 19:00-Central decline on 31 August inside August — the defect, stated", () => {
    const w = efsRejectDayWindow("2026-08-01", "2026-08-31");
    const declinedAt = "2026-09-01T00:00:00.000Z"; // 19:00 CT on 31 Aug
    expect(declinedAt >= w.gte && declinedAt < w.lt).toBe(true);
    // ...and the old bare-date instant window did not.
    expect(declinedAt <= "2026-08-31T23:59:59").toBe(false);
  });

  it("follows the DST offset rather than assuming one", () => {
    // CST is UTC−6 in January.
    expect(efsRejectDayWindow("2026-01-05", "2026-01-05").gte).toBe("2026-01-05T06:00:00.000Z");
    expect(efsRejectDayWindow("2026-01-05", "2026-01-05").lt).toBe("2026-01-06T06:00:00.000Z");
  });
});
