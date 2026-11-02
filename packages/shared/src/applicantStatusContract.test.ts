import { describe, expect, it } from "vitest";
import { applicantOwed, type ApplicantOwedFacts } from "./applicantStatusContract.js";

/** §13 SP1, D-SP2: what an applicant still owes, in the order the page lists it. */
const NOW = new Date("2026-11-03T15:00:00Z");
const NONE: ApplicantOwedFacts = { drugTestWindowsEnd: [], videosSent: false, requiredVideosUnwatched: 0, tripDepartures: [] };
const LATER = "2026-11-04T15:00:00Z";
const EARLIER = "2026-11-02T15:00:00Z";

describe("applicantOwed", () => {
  it("owes nothing when nothing is booked or sent", () => {
    expect(applicantOwed(NONE, NOW)).toEqual([]);
  });

  it("lists all three in order: the drug test, the videos, the trip", () => {
    expect(applicantOwed({ drugTestWindowsEnd: [LATER], videosSent: true, requiredVideosUnwatched: 2, tripDepartures: [LATER] }, NOW))
      .toEqual(["drug_test", "videos", "trip"]);
  });

  it("drops a drug test whose window has passed, and a trip that has left", () => {
    expect(applicantOwed({ ...NONE, drugTestWindowsEnd: [EARLIER], tripDepartures: [EARLIER] }, NOW)).toEqual([]);
    expect(applicantOwed({ ...NONE, drugTestWindowsEnd: [EARLIER, LATER] }, NOW)).toEqual(["drug_test"]);
  });

  it("owes the videos only once they were sent and while a required one is unwatched", () => {
    expect(applicantOwed({ ...NONE, videosSent: false, requiredVideosUnwatched: 3 }, NOW)).toEqual([]);
    expect(applicantOwed({ ...NONE, videosSent: true, requiredVideosUnwatched: 0 }, NOW)).toEqual([]);
    expect(applicantOwed({ ...NONE, videosSent: true, requiredVideosUnwatched: 1 }, NOW)).toEqual(["videos"]);
  });
});
