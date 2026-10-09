import { describe, expect, it } from "vitest";
import { certificationExemptionFrom } from "./certificationExemption.js";
import { GASOLINE, result } from "./paperAudit.fixtures.js";

/**
 * The document-level rules of `auditPrintedPaper`: certification and pages (the emergency number has its
 * own file, paperErPhone.test.ts). Quotes are eCFR's text of 2026-10-09.
 */

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

describe("certificationExemptionFrom — §172.204(b)(1), owner ruling Q-DR16", () => {
  it("(b)(1)(i) \"In a cargo tank supplied by the carrier\" is exempt", () => {
    expect(certificationExemptionFrom("carrier_supplied_cargo_tank")).toBe(true);
  });
  it("\"Except for a hazardous waste\" — a carrier-supplied cargo tank of hazardous waste is not exempt", () => {
    expect(certificationExemptionFrom("carrier_supplied_cargo_tank", { hazardousWaste: true })).toBe(false);
  });
  it("(b)(1)(ii) \"By the shipper as a private carrier\" is exempt only once \"not reshipped or transferred\" and \"not hazardous waste\" are both confirmed", () => {
    expect(certificationExemptionFrom("private_carrier")).toBeNull();
    expect(certificationExemptionFrom("private_carrier", { reshippedOrTransferred: false })).toBeNull();
    expect(certificationExemptionFrom("private_carrier", { hazardousWaste: false })).toBeNull();
    expect(certificationExemptionFrom("private_carrier", { reshippedOrTransferred: false, hazardousWaste: false })).toBe(true);
  });
  it("(b)(1)(ii) \"except for a hazardous material that is to be reshipped or transferred from one carrier to another\"", () => {
    expect(certificationExemptionFrom("private_carrier", { reshippedOrTransferred: true, hazardousWaste: false })).toBe(false);
  });
  it("a shipper's load on a common carrier is never exempt; an unknown relationship cannot tell", () => {
    expect(certificationExemptionFrom("shipper_supplied_common_carrier")).toBe(false);
    expect(certificationExemptionFrom("unknown")).toBeNull();
  });
});

describe("paper_page_complete — §172.201(c): \"A shipping paper may consist of more than one page, if each page is consecutively numbered and the first page bears a notation specifying the total number of pages\"", () => {
  const pages = (paper: Parameters<typeof result>[0]["paper"], resolved: Parameters<typeof result>[0]["resolved"] = {}) =>
    result({ lines: [GASOLINE()], paper, resolved }, "paper_page_complete", null);

  it("passes a paper known to be one image with no page marker", () => {
    const r = pages({}, { imageCount: 1 });
    expect(r.outcome).toBe("pass");
    expect(r.reason).toBe("single_page");
  });
  it("does not assert a single page when nobody counted the images and nothing is printed", () => {
    const r = pages({});
    expect(r.outcome).toBe("cannot_tell");
    expect(r.reason).toBe("page_count_unknown");
  });
  it("fails a two-image paper that prints no page numbering at all", () => {
    const r = pages({}, { imageCount: 2 });
    expect(r.outcome).toBe("fail");
    expect(r.reason).toBe("multi_page_unnumbered");
    expect(r.facts.pages).toBe(2);
  });
  it("fails a multi-page paper read from its per-image markers when the first page bears no total", () => {
    const r = pages({ printedPageNumbers: ["Page 1", "Page 2"] });
    expect(r.outcome).toBe("fail");
    expect(r.reason).toBe("multi_page_unnumbered");
  });
  it("passes \"Page 1 of 2\" / \"Page 2 of 2\" — consecutive, total on the first page", () => {
    const r = pages({ pageOf: { page: 1, of: 2 }, printedPageNumbers: ["Page 1 of 2", "Page 2 of 2"] });
    expect(r.outcome).toBe("pass");
    expect(r.reason).toBe("all_pages");
    expect(r.facts.firstPageTotalVerified).toBe(true);
  });
  it("fails an image with no page number on a numbered paper — \"each page is consecutively numbered\"", () => {
    const r = pages({ pageOf: { page: 1, of: 2 }, printedPageNumbers: ["Page 1 of 2", ""] });
    expect(r.outcome).toBe("fail");
    expect(r.reason).toBe("page_not_numbered");
  });
  it("fails a total printed on page 2 only — \"the first page bears a notation specifying the total\"", () => {
    const r = pages({ pageOf: { page: 2, of: 2 }, printedPageNumbers: ["Page 1", "Page 2 of 2"] });
    expect(r.outcome).toBe("fail");
    expect(r.reason).toBe("total_not_on_first_page");
  });
  it("fails a page number past the printed total", () => {
    const r = pages({ pageOf: { page: 1, of: 2 }, printedPageNumbers: ["1 of 2", "2 of 2", "3 of 2"] });
    expect(r.reason).toBe("numbering_inconsistent");
    expect(r.facts.pagesBeyond).toEqual([3]);
  });
  it("passes page 1 of 2 when both pages were seen", () => {
    const r = pages({ pageOf: { page: 1, of: 2 } }, { pagesPresent: [1, 2] });
    expect(r.outcome).toBe("pass");
    expect(r.reason).toBe("all_pages");
  });
  it("fails page 1 of 3 when page 3 never arrived", () => {
    const r = pages({ pageOf: { page: 1, of: 3 } }, { pagesPresent: [1, 2] });
    expect(r.outcome).toBe("fail");
    expect(r.facts.missingPages).toEqual([3]);
    expect(r.facts.of).toBe(3);
  });
  it("cannot tell when nobody counted the pages", () => {
    expect(pages({ pageOf: { page: 1, of: 2 } }).reason).toBe("pages_not_counted");
  });
  it("cannot tell when the page marker is Check", () => {
    const r = result({ lines: [GASOLINE()], paper: { pageOf: { page: 1, of: 2 } }, resolved: { pagesPresent: [1, 2] }, fieldStates: { "identity.pageOf.of": "check" } }, "paper_page_complete", null);
    expect(r.reason).toBe("field_unconfirmed");
  });
  it("cannot tell when an image's printed marker is Check", () => {
    const r = pages({ printedPageNumbers: ["1 of 2", "2 of 2"] });
    expect(r.outcome).toBe("pass");
    const c = result({ lines: [GASOLINE()], paper: { printedPageNumbers: ["1 of 2", "2 of 2"] }, fieldStates: { "identity.printedPageNumbers[1]": "check" } }, "paper_page_complete", null);
    expect(c.reason).toBe("field_unconfirmed");
  });
});
