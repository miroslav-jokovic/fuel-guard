import { describe, expect, it } from "vitest";
import { citationStanding, isTicket, roadsideCitationActionSchema, type RoadsideCitationDto } from "./roadsideCitationContract.js";
import { roadsideNextSteps } from "./roadsideNextSteps.js";

const TODAY = "2026-10-19";
const ticket = (o: Partial<RoadsideCitationDto> = {}): RoadsideCitationDto => ({
  violationId: "v-1", code: "392.2-SLLS1", description: "Speeding", citationNumber: "E061", courtResults: [], action: null, ...o,
});
const requested = (followUpOn: string) => ({ id: "c-1", kind: "requested_from_court" as const, followUpOn, note: null, actedBy: "Jane", actedAt: "2026-10-01T15:00:00Z" });

describe("what counts as a ticket", () => {
  it("is a citation number, never a warning the officer wrote in its place", () => {
    for (const w of ["WARNING", "Verbal", "VERBAL WARNING", "VW", "w", "N/A", "NA", " none "]) expect(isTicket(w)).toBe(false);
    for (const t of ["E061", "3V80NSNQD1", "00PP01PK"]) expect(isTicket(t)).toBe(true);
    expect(isTicket(null)).toBe(false);
    expect(isTicket("  ")).toBe(false);
  });
});

describe("where a ticket stands (R-ADJ1)", () => {
  it("is decided by FMCSA's result, whatever the office wrote", () => {
    expect(citationStanding(ticket({ courtResults: ["Not Guilty/Dismissed"], action: requested("2026-11-01") }), false, "2026-06-01", TODAY))
      .toEqual({ kind: "decided", text: "Not Guilty/Dismissed" });
  });

  it("waits 60 days for the court, then asks, and stops asking past 24 months", () => {
    expect(citationStanding(ticket(), false, "2026-08-21", TODAY)).toEqual({ kind: "too_soon", askOn: "2026-10-20" });
    expect(citationStanding(ticket(), false, "2026-08-20", TODAY)).toEqual({ kind: "ask" });
    expect(citationStanding(ticket(), false, "2024-10-19", TODAY)).toEqual({ kind: "ask" });
    expect(citationStanding(ticket(), false, "2024-10-18", TODAY)).toEqual({ kind: "too_old" });
  });

  it("waits after a request until its follow-up day, then asks again", () => {
    expect(citationStanding(ticket({ action: requested("2026-10-20") }), false, "2026-06-01", TODAY)).toEqual({ kind: "requested", followUpOn: "2026-10-20" });
    expect(citationStanding(ticket({ action: requested("2026-10-19") }), false, "2026-06-01", TODAY).kind).toBe("follow_up");
  });

  it("is closed by a filed court result or by 'not contested'", () => {
    expect(citationStanding(ticket(), true, "2026-06-01", TODAY)).toEqual({ kind: "result_filed" });
    const paid = { id: "c-2", kind: "not_contested" as const, followUpOn: null, note: null, actedBy: "Jane", actedAt: "x" };
    expect(citationStanding(ticket({ action: paid }), false, "2026-06-01", TODAY)).toEqual({ kind: "not_contested" });
  });
});

describe("tickets as next steps", () => {
  const attribution = { reading: null, decision: null, basedOn: null, reports: [] };
  const steps = (tickets: RoadsideCitationDto[], filed = false, inspectionDate = "2026-06-01") =>
    roadsideNextSteps({ attribution, inspectionDate, repairs: [], certification: null, citations: { tickets, courtResultFiled: filed }, today: TODAY });

  it("is one safety step per ticket, open when the court must be asked, and absent past 24 months", () => {
    const s = steps([ticket(), ticket({ violationId: "v-2", citationNumber: "E062", action: requested("2026-11-18") })]);
    expect(s.find((x) => x.key === "citation:v-1")).toMatchObject({ owner: "safety", section: "citations", state: "open", title: "Ticket E061: get the court result" });
    expect(s.find((x) => x.key === "citation:v-2")).toMatchObject({ state: "waiting", detail: "Follow up on 11/18/2026 if nothing is filed." });
    expect(steps([ticket()], false, "2024-01-01").some((x) => x.key.startsWith("citation:"))).toBe(false);
  });

  it("closes every ticket on the inspection once a court result is filed on it", () => {
    expect(steps([ticket(), ticket({ violationId: "v-2" })], true).filter((x) => x.key.startsWith("citation:")).map((x) => x.state)).toEqual(["done", "done"]);
  });
});

describe("the office's act", () => {
  it("needs a real day to follow up on a request, and none on 'not contested'", () => {
    const v = "11111111-1111-4111-8111-111111111111";
    expect(roadsideCitationActionSchema.safeParse({ action: "requested_from_court", violationId: v, basedOn: null, followUpOn: "2026-11-18" }).success).toBe(true);
    expect(roadsideCitationActionSchema.safeParse({ action: "requested_from_court", violationId: v, basedOn: null, followUpOn: "2026-02-31" }).success).toBe(false);
    expect(roadsideCitationActionSchema.safeParse({ action: "not_contested", violationId: v, basedOn: null }).success).toBe(true);
  });
});
