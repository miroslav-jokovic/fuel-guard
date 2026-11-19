import { describe, expect, it } from "vitest";
import { compareLeadStanding, leadStanding, type LeadStandingInput } from "./leadStanding.js";

/** V7b (Q-APX24 (a)): the standing and its reasons, one rule at a time, and the page order. */

const line = (line_type: "mobile" | "landline" | "voip" | "unknown", valid: boolean | null = true) =>
  ({ line_type, valid, carrier: null, looked_up_at: "2026-11-19T00:00:00Z" });
const ROW: LeadStandingInput = {
  summary: { hardUnmet: 0, unknown: 2, met: 1 }, phone_line: line("mobile"), drivers: [], also: [],
  do_not_contact: false, phone_e164: "+17082365732", email_lower: null,
};

describe("leadStanding", () => {
  it("an ordinary lead is Call with nothing to say", () => {
    expect(leadStanding(ROW)).toEqual({ standing: "call", reasons: [] });
  });

  it("a failed hard requirement decides first, over every check", () => {
    const r = leadStanding({ ...ROW, summary: { hardUnmet: 2, unknown: 0, met: 0 }, do_not_contact: true });
    expect(r).toEqual({ standing: "does_not_qualify", reasons: ["Said they miss 2 requirements"] });
    expect(leadStanding({ ...ROW, summary: { hardUnmet: 1, unknown: 0, met: 0 } }).reasons).toEqual(["Said they miss 1 requirement"]);
  });

  it.each([
    [{ do_not_contact: true }, "Asked not to be contacted"],
    [{ drivers: [{ id: "d", status: "active", archived: false }] }, "Already drives for you"],
    [{ phone_line: line("mobile", false) }, "Telnyx says the number is not valid"],
    [{ phone_e164: null, email_lower: null, phone_line: null }, "Nothing to call or write to"],
  ] as const)("Check first: %o", (over, reason) => {
    expect(leadStanding({ ...ROW, ...over } as LeadStandingInput)).toEqual({ standing: "check_first", reasons: [reason] });
  });

  it("names every check that holds, in order", () => {
    const r = leadStanding({ ...ROW, do_not_contact: true, drivers: [{ id: "d", status: "active", archived: false }] });
    expect(r.reasons).toEqual(["Asked not to be contacted", "Already drives for you"]);
  });

  it("a driver who left, or an archived one, is a reason to know, not a check", () => {
    for (const d of [{ id: "d", status: "terminated", archived: false }, { id: "d", status: "active", archived: true }]) {
      expect(leadStanding({ ...ROW, drivers: [d] })).toEqual({ standing: "call", reasons: ["On file as a driver or applicant"] });
    }
  });

  it("a landline, an internet line and an earlier lead are reasons under Call, never a demotion (Q-AD62)", () => {
    expect(leadStanding({ ...ROW, phone_line: line("landline") })).toEqual({ standing: "call", reasons: ["Landline — cannot be texted"] });
    expect(leadStanding({ ...ROW, phone_line: line("voip") })).toEqual({ standing: "call", reasons: ["Internet line"] });
    expect(leadStanding({ ...ROW, also: [{ id: "x", channel: "meta", campaign_ref: null, received_at: "2026-10-01T00:00:00Z" }] }).reasons).toEqual(["Applied before"]);
  });

  it("an e-mail with no phone is callable by writing; an invalid line with no phone is not read", () => {
    expect(leadStanding({ ...ROW, phone_e164: null, email_lower: "a@b.c", phone_line: null }).standing).toBe("call");
  });

  it("a number not looked up yet is neither good nor bad", () => {
    expect(leadStanding({ ...ROW, phone_line: null })).toEqual({ standing: "call", reasons: [] });
  });
});

describe("compareLeadStanding", () => {
  it("Call, then Check first, then Does not qualify; fewer to check first; unmatched last; else stable", () => {
    const rows: Array<LeadStandingInput & { n: string }> = [
      { ...ROW, n: "dnq", summary: { hardUnmet: 1, unknown: 0, met: 0 } },
      { ...ROW, n: "check", do_not_contact: true },
      { ...ROW, n: "unmatched", summary: null },
      { ...ROW, n: "three", summary: { hardUnmet: 0, unknown: 3, met: 0 } },
      { ...ROW, n: "one-a", summary: { hardUnmet: 0, unknown: 1, met: 2 } },
      { ...ROW, n: "one-b", summary: { hardUnmet: 0, unknown: 1, met: 0 } },
      { ...ROW, n: "unmatched-2", summary: null },
    ];
    expect([...rows].sort(compareLeadStanding).map((r) => r.n)).toEqual(["one-a", "one-b", "three", "unmatched", "unmatched-2", "check", "dnq"]);
  });
});
