import { describe, expect, it } from "vitest";
import { tripLinesFor, type TripRow } from "./applicantTrip.js";

/**
 * The trip as the applicant reads it (§12 MT3): on the CARRIER's clock, whatever clock the server runs
 * on — a test run on a Chicago laptop cannot tell the two apart for a Chicago carrier, so this one is
 * a Pacific carrier.
 */
const TRIP: TripRow = {
  id: "t", invitation_id: "i", mode: "air", depart_at: "2027-01-14T14:00:00Z", arrive_at: "2027-01-14T20:30:00Z",
  confirmation_ref: null, cancelled_at: null,
};

describe("tripLinesFor", () => {
  it("reads the times on the carrier's zone and names it", () => {
    expect(tripLinesFor(TRIP, "America/Los_Angeles")).toEqual({
      mode: "Flight", leaves: "01/14/2027 6:00 AM PST", arrives: "01/14/2027 12:30 PM PST", confirmation: null,
    });
  });

  it("names daylight time in summer", () => {
    expect(tripLinesFor({ ...TRIP, depart_at: "2027-07-14T14:00:00Z" }, "America/New_York").leaves).toBe("07/14/2027 10:00 AM EDT");
  });
});
