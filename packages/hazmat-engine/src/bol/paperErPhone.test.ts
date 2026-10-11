import { describe, expect, it } from "vitest";
import { ER_PHONE_EXCEPTED_SHIPPING_NAMES } from "./paperErPhone.js";
import { GASOLINE, failed, ok, pline, result, rline } from "./paperAudit.fixtures.js";

/**
 * paper_er_phone against the text of 49 CFR 172.604 as eCFR printed it on 2026-10-09 (Title 49 up to date
 * as of 2026-10-07). Each title quotes the paragraph the case stands on.
 */

const phone = (emergencyPhone: string | null, lines = [GASOLINE()]) => result({ lines, paper: { emergencyPhone } }, "paper_er_phone", null);

describe("paper_er_phone — §172.604(a): \"a numeric emergency response telephone number, including the area code\"", () => {
  it("passes a ten-digit NANP number with a valid area code", () => {
    const r = phone("(800) 424-9300");
    expect(r.outcome).toBe("pass");
    expect(r.reason).toBe("well_formed");
    expect(r.facts.digits).toBe("8004249300");
  });
  it("passes the same number with a leading 1", () => {
    expect(phone("1-800-424-9300").facts.digits).toBe("8004249300");
  });
  it("does not pass words beside a number — \"CALL SHIPPER 800 555 1212\" was a pass before the letters were looked at first", () => {
    const r = phone("CALL SHIPPER 800 555 1212");
    expect(r.outcome).not.toBe("pass");
    expect(r.outcome).toBe("cannot_tell");
    expect(r.reason).toBe("words_beside_number");
  });
  it("fails words in place of a number (\"numeric\")", () => {
    const r = phone("CALL SHIPPER");
    expect(r.outcome).toBe("fail");
    expect(r.reason).toBe("not_a_number");
  });
  it("fails a vanity number spelled in letters (\"numeric\")", () => {
    expect(phone("1-800-CHEMTREC").reason).toBe("not_numeric");
  });
  it("fails a seven-digit number — \"including the area code\"", () => {
    const r = phone("424-9300");
    expect(r.outcome).toBe("fail");
    expect(r.reason).toBe("too_short");
  });
  it("cannot tell a ten-digit number whose area code is not NANP-shaped, rather than calling it right or wrong", () => {
    const r = phone("(100) 424-9300");
    expect(r.outcome).toBe("cannot_tell");
    expect(r.reason).toBe("number_shape_unrecognised");
  });
  it("passes an extension and reports it, leaving it out of the number's digits", () => {
    const r = phone("800-424-9300 ext. 22");
    expect(r.outcome).toBe("pass");
    expect(r.facts.digits).toBe("8004249300");
    expect(r.facts.extension).toBe("22");
  });
  it("accepts \"the international access code or the \"+\" (plus) sign, country code, and city code\" for a number outside the United States", () => {
    const plus = phone("+44 20 7946 0958");
    expect(plus.outcome).toBe("pass");
    expect(plus.reason).toBe("international");
    expect(phone("011 44 20 7946 0958").reason).toBe("international");
  });
  it("fails a missing number when a line needs one", () => {
    const r = phone(null);
    expect(r.outcome).toBe("fail");
    expect(r.reason).toBe("missing");
  });
  it("cannot tell when the number is Not read", () => {
    const r = result({ lines: [GASOLINE()], paper: { emergencyPhone: null }, fieldStates: { "hazmat.emergencyPhone": "not_read" } }, "paper_er_phone", null);
    expect(r.outcome).toBe("cannot_tell");
  });
});

describe("paper_er_phone — §172.604(d): \"The requirements of this section do not apply to—\"", () => {
  it("(d)(1) \"offered for transportation under the provisions applicable to limited quantities\": a missing number on an all-LQ paper is not a fail", () => {
    const lq: ReturnType<typeof GASOLINE> = [pline({ marks: ["LTD QTY"], packaging: "4 cases" }), rline(ok("UN1203-gasoline", "II"), { packagingKind: "non_bulk" })];
    const r = phone(null, [lq]);
    expect(r.outcome).toBe("pass");
    expect(r.reason).toBe("excepted_172_604_d");
    expect(r.facts.exceptions).toEqual(["d1_limited_quantity"]);
  });
  it("(d)(1) \"…or excepted quantities\": an excepted-quantity line the caller vouches for is excepted", () => {
    const eq: ReturnType<typeof GASOLINE> = [pline(), rline(ok("UN1203-gasoline", "II"), { claimedExceptedQuantity: true })];
    expect(phone(null, [eq]).facts.exceptions).toEqual(["d1_excepted_quantity"]);
  });
  it("(d)(2) \"Materials properly described under the following shipping names\": Battery powered equipment", () => {
    const bpe: ReturnType<typeof GASOLINE> = [
      pline({ idText: "UN3171", psn: "Battery-powered equipment", hazardClass: "9", pg: null }),
      rline(ok("UN3171-battery-powered-vehicle", null, { matchedName: "Battery-powered equipment" })),
    ];
    const r = phone(null, [bpe]);
    expect(r.outcome).toBe("pass");
    expect(r.facts.exceptions).toEqual(["d2_named_material"]);
  });
  it("(d)(2)(xvii) \"Krill Meal, PG III\" — and only PG III", () => {
    const krill = (pg: "II" | "III"): ReturnType<typeof GASOLINE> => [pline({ idText: "UN3497", psn: "Krill meal", hazardClass: "4.2", pg }), rline(ok("UN3497-krill-meal", pg))];
    expect(phone(null, [krill("III")]).reason).toBe("excepted_172_604_d");
    expect(phone(null, [krill("II")]).reason).toBe("missing");
  });
  it("quotes the (d)(2) list verbatim — twenty-six names, (i) through (xxvi)", () => {
    expect(ER_PHONE_EXCEPTED_SHIPPING_NAMES).toHaveLength(26);
    expect(ER_PHONE_EXCEPTED_SHIPPING_NAMES[0]).toBe("Battery powered equipment");
    expect(ER_PHONE_EXCEPTED_SHIPPING_NAMES[16]).toBe("Krill Meal, PG III");
    expect(ER_PHONE_EXCEPTED_SHIPPING_NAMES[25]).toBe("Wheelchair, electric");
  });
  it("(d)(3) \"Transportation vehicles or freight containers containing lading that has been fumigated and displaying the FUMIGANT marking … unless other hazardous materials are present\"", () => {
    const r = result({ lines: [GASOLINE()], paper: { emergencyPhone: null }, resolved: { fumigatedUnitNoOtherHazmat: true } }, "paper_er_phone", null);
    expect(r.reason).toBe("excepted_172_604_d");
    expect(r.facts.exceptions).toEqual(["d3_fumigated_unit"]);
  });
  it("still fails a missing number when one line of several is not excepted", () => {
    const lq: ReturnType<typeof GASOLINE> = [pline({ marks: ["LTD QTY"] }), rline(ok("UN1203-gasoline", "II"))];
    expect(phone(null, [lq, GASOLINE()]).reason).toBe("missing");
  });
  it("cannot tell a missing number when a line that might be excepted did not resolve", () => {
    const unresolved: ReturnType<typeof GASOLINE> = [pline({ idText: "UN3171", psn: "Battery powered equipment" }), rline(failed("psn_ambiguous"))];
    const r = phone(null, [unresolved]);
    expect(r.outcome).toBe("cannot_tell");
    expect(r.reason).toBe("exception_may_apply");
  });
  it("does not let a malformed number fail a paper that may need no number at all", () => {
    const unresolved: ReturnType<typeof GASOLINE> = [pline({ idText: "UN3171", psn: "Battery powered equipment" }), rline(failed("psn_ambiguous"))];
    expect(phone("424-9300", [unresolved]).reason).toBe("exception_may_apply");
  });
});
