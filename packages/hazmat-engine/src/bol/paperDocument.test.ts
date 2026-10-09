import { describe, expect, it } from "vitest";
import { GASOLINE, failed, pline, result, rline } from "./paperAudit.fixtures.js";

/** The document-level rules of `auditPrintedPaper`: emergency phone, certification, pages. */

describe("paper_er_phone — a 24-hour number with its area code (§172.604)", () => {
  it("passes a ten-digit number", () => {
    const r = result({ lines: [GASOLINE()], paper: { emergencyPhone: "(800) 424-9300" } }, "paper_er_phone", null);
    expect(r.outcome).toBe("pass");
    expect(r.facts.digits).toBe("8004249300");
  });
  it("fails the first real BOL (F-DR11): lead-acid batteries, no emergency number", () => {
    const lead = pline({ idText: null, psn: null, hazardClass: null, pg: null, hmColumnMark: "X" });
    const r = result({ lines: [[lead, rline(failed("id_missing"))]], paper: { emergencyPhone: null } }, "paper_er_phone", null);
    expect(r.outcome).toBe("fail");
    expect(r.reason).toBe("missing");
  });
  it("fails the \"call shipper\" pattern — words in place of a number", () => {
    const r = result({ lines: [GASOLINE()], paper: { emergencyPhone: "CALL SHIPPER" } }, "paper_er_phone", null);
    expect(r.reason).toBe("not_a_number");
    expect(r.facts.printed).toBe("CALL SHIPPER");
  });
  it("fails a seven-digit number — no area code", () => {
    expect(result({ lines: [GASOLINE()], paper: { emergencyPhone: "424-9300" } }, "paper_er_phone", null).reason).toBe("too_short");
  });
  it("cannot tell when the number is Not read", () => {
    const r = result({ lines: [GASOLINE()], paper: { emergencyPhone: null }, fieldStates: { "hazmat.emergencyPhone": "not_read" } }, "paper_er_phone", null);
    expect(r.outcome).toBe("cannot_tell");
  });
});

describe("paper_certification — the shipper's certification is present (§172.204)", () => {
  it("passes when it is printed", () => {
    expect(result({ lines: [GASOLINE()] }, "paper_certification", null).reason).toBe("present");
  });
  it("passes an absent certification when a §172.204(b) exception applies", () => {
    expect(result({ lines: [GASOLINE()], paper: { shipperCertification: false }, resolved: { certificationExempt: true } }, "paper_certification", null).reason).toBe("exempt");
  });
  it("fails an absent certification when no exception applies", () => {
    const r = result({ lines: [GASOLINE()], paper: { shipperCertification: false }, resolved: { certificationExempt: false } }, "paper_certification", null);
    expect(r.outcome).toBe("fail");
    expect(r.reason).toBe("missing");
  });
  it("cannot tell an absent certification when nobody knows whether an exception applies", () => {
    expect(result({ lines: [GASOLINE()], paper: { shipperCertification: false } }, "paper_certification", null).reason).toBe("exception_may_apply");
  });
  it("cannot tell when the reader could not see whether it is there", () => {
    expect(result({ lines: [GASOLINE()], paper: { shipperCertification: null } }, "paper_certification", null).reason).toBe("not_seen");
  });
});

describe("paper_page_complete — every page of \"n of m\" is here (§172.201(c))", () => {
  it("passes a paper with no page marker", () => {
    expect(result({ lines: [GASOLINE()] }, "paper_page_complete", null).reason).toBe("single_page");
  });
  it("passes page 1 of 2 when both pages were seen", () => {
    const r = result({ lines: [GASOLINE()], paper: { pageOf: { page: 1, of: 2 } }, resolved: { pagesPresent: [1, 2] } }, "paper_page_complete", null);
    expect(r.outcome).toBe("pass");
    expect(r.reason).toBe("all_pages");
  });
  it("fails page 1 of 3 when page 3 never arrived", () => {
    const r = result({ lines: [GASOLINE()], paper: { pageOf: { page: 1, of: 3 } }, resolved: { pagesPresent: [1, 2] } }, "paper_page_complete", null);
    expect(r.outcome).toBe("fail");
    expect(r.facts.missingPages).toEqual([3]);
    expect(r.facts.of).toBe(3);
  });
  it("cannot tell when nobody counted the pages", () => {
    expect(result({ lines: [GASOLINE()], paper: { pageOf: { page: 1, of: 2 } } }, "paper_page_complete", null).reason).toBe("pages_not_counted");
  });
  it("cannot tell when the page marker is Check", () => {
    const r = result({ lines: [GASOLINE()], paper: { pageOf: { page: 1, of: 2 } }, resolved: { pagesPresent: [1, 2] }, fieldStates: { "identity.pageOf.of": "check" } }, "paper_page_complete", null);
    expect(r.reason).toBe("field_unconfirmed");
  });
});
