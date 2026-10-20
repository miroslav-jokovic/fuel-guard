import { describe, expect, it } from "vitest";
import {
  citationStanding,
  courtPaperFiledAt,
  isTicket,
  roadsideCitationActionSchema,
  roadsideCitationDispositionSchema,
  type RoadsideCitationDispositionDto,
  type RoadsideCitationDto,
  type RoadsideDataqsCaseDto,
} from "./roadsideCitationContract.js";
import { roadsideNextSteps } from "./roadsideNextSteps.js";

const TODAY = "2026-10-19";
const ticket = (o: Partial<RoadsideCitationDto> = {}): RoadsideCitationDto => ({
  violationId: "v-1", code: "392.2-SLLS1", description: "Speeding", citationNumber: "E061", courtResults: [], action: null, disposition: null, dataqsCase: null, ...o,
});
const disposition = (o: Partial<RoadsideCitationDispositionDto> = {}): RoadsideCitationDispositionDto => ({
  id: "d-1", outcomeCode: 3, amendedCharge: null, courtName: "Will County Circuit Court", decidedOn: "2026-09-01", documentId: "doc-1",
  note: null, recordedBy: "Jane", recordedAt: "2026-10-02T15:00:00Z", ...o,
});
const dataqs = (o: Partial<RoadsideDataqsCaseDto> = {}): RoadsideDataqsCaseDto => ({
  id: "q-1", state: "approved", dispositionId: "d-1", narrative: "…", attestedBy: "Jane", attestedAt: "2026-10-03T15:00:00Z", rdrNumber: null, filedOn: null, ...o,
});
const PAPER = "2026-10-02T12:00:00Z";
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
    expect(citationStanding(ticket({ courtResults: ["Not Guilty/Dismissed"], action: requested("2026-11-01"), disposition: disposition() }), PAPER, "2026-06-01", TODAY))
      .toEqual({ kind: "decided", text: "Not Guilty/Dismissed" });
  });

  it("waits 60 days for the court, then asks, and stops asking past 24 months", () => {
    expect(citationStanding(ticket(), null, "2026-08-21", TODAY)).toEqual({ kind: "too_soon", askOn: "2026-10-20" });
    expect(citationStanding(ticket(), null, "2026-08-20", TODAY)).toEqual({ kind: "ask" });
    expect(citationStanding(ticket(), null, "2024-10-19", TODAY)).toEqual({ kind: "ask" });
    expect(citationStanding(ticket(), null, "2024-10-18", TODAY)).toEqual({ kind: "too_old" });
  });

  it("waits after a request until its follow-up day, then asks again", () => {
    expect(citationStanding(ticket({ action: requested("2026-10-20") }), null, "2026-06-01", TODAY)).toEqual({ kind: "requested", followUpOn: "2026-10-20" });
    expect(citationStanding(ticket({ action: requested("2026-10-19") }), null, "2026-06-01", TODAY).kind).toBe("follow_up");
  });

  it("is closed by 'not contested'", () => {
    const paid = { id: "c-2", kind: "not_contested" as const, followUpOn: null, note: null, actedBy: "Jane", actedAt: "2026-10-01T00:00:00Z" };
    expect(citationStanding(ticket({ action: paid }), null, "2026-06-01", TODAY)).toEqual({ kind: "not_contested" });
  });

  it("asks what a filed court paper decided, unless the office acted on the ticket after it was filed", () => {
    expect(citationStanding(ticket(), PAPER, "2026-06-01", TODAY)).toEqual({ kind: "record_result" });
    expect(citationStanding(ticket({ action: requested("2026-10-01") }), PAPER, "2026-06-01", TODAY)).toEqual({ kind: "record_result" });
    // Asked the court again after the paper was filed: the paper was another ticket's.
    const after = { ...requested("2026-11-18"), actedAt: "2026-10-05T00:00:00Z" };
    expect(citationStanding(ticket({ action: after }), PAPER, "2026-06-01", TODAY)).toEqual({ kind: "requested", followUpOn: "2026-11-18" });
    // "Not contested" said before the paper arrived does not outrank the paper: the court's word is in.
    const paidBefore = { id: "c-2", kind: "not_contested" as const, followUpOn: null, note: null, actedBy: "Jane", actedAt: "2026-09-15T00:00:00Z" };
    expect(citationStanding(ticket({ action: paidBefore }), PAPER, "2026-06-01", TODAY)).toEqual({ kind: "record_result" });
    // Nothing to ask past SMS's 24 months, paper or not.
    expect(citationStanding(ticket(), PAPER, "2024-01-01", TODAY)).toEqual({ kind: "too_old" });
  });

  it("is the newest paper that counts", () => {
    expect(courtPaperFiledAt([{ filedAt: "2026-10-05T00:00:00Z" }, { filedAt: PAPER }])).toBe("2026-10-05T00:00:00Z");
    expect(courtPaperFiledAt([])).toBeNull();
  });
});

describe("what the court decided (R-ADJ2, R-ADJ3)", () => {
  it("has nothing to file for a conviction of the charge, or past 24 months", () => {
    const d = disposition({ outcomeCode: 1 });
    expect(citationStanding(ticket({ disposition: d }), PAPER, "2026-06-01", TODAY)).toEqual({ kind: "court_decided", disposition: d, why: "no_change" });
    const old = disposition();
    expect(citationStanding(ticket({ disposition: old }), PAPER, "2024-01-01", TODAY)).toEqual({ kind: "court_decided", disposition: old, why: "too_old" });
  });

  it("makes a dismissal or a different charge FMCSA does not show a request to prepare", () => {
    for (const code of [3, 2] as const) {
      const d = disposition({ outcomeCode: code, amendedCharge: code === 2 ? "392.2-SLLS1 speeding 6-10" : null });
      expect(citationStanding(ticket({ disposition: d }), PAPER, "2026-06-01", TODAY)).toEqual({ kind: "file_ready", disposition: d, redraft: false });
    }
  });

  it("outranks an act recorded before it, and 'not contested'", () => {
    const paid = { id: "c-2", kind: "not_contested" as const, followUpOn: null, note: null, actedBy: "Jane", actedAt: "2026-10-09T00:00:00Z" };
    expect(citationStanding(ticket({ action: paid, disposition: disposition() }), PAPER, "2026-06-01", TODAY).kind).toBe("file_ready");
  });

  it("is to file once approved, and asks again when the disposition was recorded again after approval", () => {
    const d = disposition();
    expect(citationStanding(ticket({ disposition: d, dataqsCase: dataqs() }), PAPER, "2026-06-01", TODAY).kind).toBe("file_approved");
    expect(citationStanding(ticket({ disposition: disposition({ id: "d-2" }), dataqsCase: dataqs() }), PAPER, "2026-06-01", TODAY))
      .toMatchObject({ kind: "file_ready", redraft: true });
  });

  it("is filed once DataQs gave it a number, whatever was recorded since — until FMCSA's result arrives", () => {
    const filed = dataqs({ state: "filed", rdrNumber: "1234567", filedOn: "2026-10-04" });
    expect(citationStanding(ticket({ disposition: disposition({ id: "d-2", outcomeCode: 1 }), dataqsCase: filed }), PAPER, "2026-06-01", TODAY))
      .toEqual({ kind: "filed", dataqs: filed });
    expect(citationStanding(ticket({ disposition: disposition(), dataqsCase: filed, courtResults: ["Not Guilty/Dismissed"] }), PAPER, "2026-06-01", TODAY).kind)
      .toBe("decided");
  });
});

describe("tickets as next steps", () => {
  const attribution = { reading: null, decision: null, basedOn: null, reports: [] };
  const steps = (tickets: RoadsideCitationDto[], paper: string | null = null, inspectionDate = "2026-06-01") =>
    roadsideNextSteps({ attribution, inspectionDate, repairs: [], certification: null, citations: { tickets, courtPaperFiledAt: paper }, today: TODAY });

  it("is one safety step per ticket, open when the court must be asked, and absent past 24 months", () => {
    const s = steps([ticket(), ticket({ violationId: "v-2", citationNumber: "E062", action: requested("2026-11-18") })]);
    expect(s.find((x) => x.key === "citation:v-1")).toMatchObject({ owner: "safety", section: "citations", state: "open", title: "Ticket E061: get the court result" });
    expect(s.find((x) => x.key === "citation:v-2")).toMatchObject({ state: "waiting", detail: "Follow up on 11/18/2026 if nothing is filed." });
    expect(steps([ticket()], null, "2024-01-01").some((x) => x.key.startsWith("citation:"))).toBe(false);
  });

  it("does not close a second ticket on the paper the first one was recorded from", () => {
    const s = steps([ticket({ disposition: disposition({ outcomeCode: 1 }) }), ticket({ violationId: "v-2", citationNumber: "E062" })], PAPER);
    expect(s.filter((x) => x.key.startsWith("citation:")).map((x) => [x.key, x.state, x.title])).toEqual([
      ["citation:v-2", "open", "Ticket E062: record what the court decided"],
      ["citation:v-1", "done", "Ticket E061: convicted of the charge"],
    ]);
  });

  it("opens the DataQs request, then its filing, and closes on the RDR number", () => {
    const d = disposition();
    const step = (t: RoadsideCitationDto) => steps([t], PAPER).find((x) => x.key === "citation:v-1")!;
    expect(step(ticket({ disposition: d }))).toMatchObject({ state: "open", title: "Ticket E061: prepare the DataQs request" });
    expect(step(ticket({ disposition: d, dataqsCase: dataqs() }))).toMatchObject({ state: "open", title: "Ticket E061: file it in DataQs" });
    expect(step(ticket({ disposition: d, dataqsCase: dataqs({ state: "filed", rdrNumber: "1234567", filedOn: "2026-10-04" }) })))
      .toMatchObject({ state: "done", title: "Ticket E061: filed in DataQs, RDR 1234567" });
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

describe("recording what the court decided", () => {
  const v = "11111111-1111-4111-8111-111111111111";
  const base = { violationId: v, basedOn: null, documentId: v, outcomeCode: 3, courtName: "Will County Circuit Court", decidedOn: "2026-09-01" };
  it("needs a court, a real day, and the new charge exactly when it is a different charge", () => {
    expect(roadsideCitationDispositionSchema.safeParse(base).success).toBe(true);
    expect(roadsideCitationDispositionSchema.safeParse({ ...base, courtName: " " }).success).toBe(false);
    expect(roadsideCitationDispositionSchema.safeParse({ ...base, decidedOn: "2026-02-30" }).success).toBe(false);
    expect(roadsideCitationDispositionSchema.safeParse({ ...base, outcomeCode: 2 }).success).toBe(false);
    expect(roadsideCitationDispositionSchema.safeParse({ ...base, outcomeCode: 2, amendedCharge: "Speeding 6-10" }).success).toBe(true);
    expect(roadsideCitationDispositionSchema.safeParse({ ...base, amendedCharge: "Speeding 6-10" }).success).toBe(false);
    expect(roadsideCitationDispositionSchema.safeParse({ ...base, outcomeCode: 0 }).success).toBe(false);
  });
});
