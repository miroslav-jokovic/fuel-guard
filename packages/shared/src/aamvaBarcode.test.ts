import { describe, expect, it } from "vitest";
import { aamvaDate, issuerJurisdiction, parseAamvaBarcode } from "./aamvaBarcode.js";

/**
 * The licence barcode reader (AW5), case by case.
 *
 * Every barcode here is built by `encode`, which lays one out by the standard's §D.12.3 (header) and
 * §D.12.4 (designators) — one per case: other states and versions, a Canadian date order, a wrong
 * offset, swapped separators, a barcode cut short, and texts that are not AAMVA.
 *
 * ⚠ The checks against the committed standard itself — §D.13's own example read byte for byte, every
 * element ID found in Table D.3/D.4, the IIN table row for row, and a real PDF417 decoded — are in
 * `apps/web/.../readLicenceBarcode.test.ts`, because they read files and this package has, on purpose,
 * no Node types (it ships to React Native too).
 */

interface Subfile {
  type: string;
  elements: Array<[string, string]>;
}

/** A barcode laid out by §D.12.3 (header) and §D.12.4 (designators: type, offset, length). */
function encode(iin: string, version: string, subfiles: Subfile[], opts: { separator?: string; offsetSkew?: number } = {}): string {
  const sep = opts.separator ?? "\n";
  const bodies = subfiles.map((s) => `${s.type}${s.elements.map(([id, v]) => `${id}${v}`).join(sep)}\r`);
  const headerLength = 4 + 5 + 6 + 2 + 2 + 2 + subfiles.length * 10;
  let offset = headerLength;
  const designators = bodies.map((b, i) => {
    const d = `${subfiles[i]!.type}${String(offset + (opts.offsetSkew ?? 0)).padStart(4, "0")}${String(b.length).padStart(4, "0")}`;
    offset += b.length;
    return d;
  });
  return `@\n\u001e\rANSI ${iin}${version}00${String(subfiles.length).padStart(2, "0")}${designators.join("")}${bodies.join("")}`;
}

const illinois: Subfile = {
  type: "DL",
  elements: [
    ["DAQ", "J12345678901"],
    ["DCS", "KOWALSKI"],
    ["DAC", "ANNA"],
    ["DAD", "MARIA"],
    ["DBD", "03152022"],
    ["DBB", "11301979"],
    ["DBA", "11302027"],
    ["DAG", "123 N STATE ST"],
    ["DAH", "APT 4B"],
    ["DAI", "CHICAGO"],
    ["DAJ", "IL"],
    ["DAK", "606011234  "],
    ["DCG", "USA"],
  ],
};

describe("the issuing state", () => {
  it("derives it by name, so AAMVA's 'GM' for Colorado is never read", () => {
    expect(issuerJurisdiction("636020")).toBe("CO");
    expect(issuerJurisdiction("636035")).toBe("IL");
    expect(issuerJurisdiction("636012")).toBe("ON");
    // A name the catalogue does not hold is no state, never a guess.
    expect(issuerJurisdiction("636016")).toBeNull(); // "Newfoundland"
    expect(issuerJurisdiction("636056")).toBeNull(); // Coahuila
    expect(issuerJurisdiction("999999")).toBeNull();
  });
});

describe("other states, versions and card types", () => {
  it("reads an Illinois licence (version 09) with a second address line and a ZIP+4", () => {
    const got = parseAamvaBarcode(encode("636035", "09", [illinois]));
    expect(got).toMatchObject({
      aamvaVersion: 9,
      issuingState: "IL",
      licenceNumber: "J12345678901",
      dateOfBirth: "1979-11-30",
      expiresOn: "2027-11-30",
      address: { line1: "123 N STATE ST", line2: "APT 4B", city: "CHICAGO", state: "IL", postalCode: "60601" },
    });
  });

  it("reads a Texas identification card (the ID subfile), version 08", () => {
    const got = parseAamvaBarcode(
      encode("636015", "08", [{ type: "ID", elements: [["DAQ", "12345678"], ["DBB", "01021990"], ["DAK", "78701"]] }]),
    );
    expect(got).toMatchObject({ issuingState: "TX", licenceNumber: "12345678", dateOfBirth: "1990-01-02" });
    expect(got?.address.postalCode).toBe("78701");
  });

  it("reads Canada's CCYYMMDD dates and refuses a postal code the form cannot hold", () => {
    const got = parseAamvaBarcode(
      encode("636012", "10", [
        { type: "DL", elements: [["DAQ", "K1234-56789-01234"], ["DBB", "19860606"], ["DBA", "20290131"], ["DAJ", "ON"], ["DAK", "M5V 2T6"], ["DCG", "CAN"]] },
      ]),
    );
    expect(got).toMatchObject({ issuingState: "ON", dateOfBirth: "1986-06-06", expiresOn: "2029-01-31" });
    expect(got?.address).toMatchObject({ state: "ON", postalCode: null });
  });

  it("reads a pre-2009 version by the same structure (its element tables are not published)", () => {
    const got = parseAamvaBarcode(encode("636001", "03", [{ type: "DL", elements: [["DAQ", "123456789"], ["DBB", "07041976"]] }]));
    expect(got).toMatchObject({ aamvaVersion: 3, issuingState: "NY", licenceNumber: "123456789", dateOfBirth: "1976-07-04" });
  });

  it("finds the card subfile behind a jurisdiction subfile listed first", () => {
    const got = parseAamvaBarcode(encode("636035", "10", [{ type: "ZI", elements: [["ZIA", "X"]] }, illinois]));
    expect(got?.licenceNumber).toBe("J12345678901");
  });
});

describe("barcodes as they really come off a camera", () => {
  it("survives a designator offset that points at the wrong byte", () => {
    const got = parseAamvaBarcode(encode("636035", "10", [illinois], { offsetSkew: 7 }));
    expect(got?.licenceNumber).toBe("J12345678901");
    expect(got?.address.city).toBe("CHICAGO");
  });

  it("survives CR instead of LF between elements", () => {
    const got = parseAamvaBarcode(encode("636035", "10", [illinois], { separator: "\r" }));
    expect(got?.dateOfBirth).toBe("1979-11-30");
    expect(got?.address.postalCode).toBe("60601");
  });

  it("keeps what a barcode cut short did say, and nothing it did not", () => {
    const full = encode("636035", "10", [illinois]);
    const cut = full.slice(0, full.indexOf("DAC"));
    const got = parseAamvaBarcode(cut);
    expect(got).toMatchObject({ licenceNumber: "J12345678901", familyName: "KOWALSKI", firstName: null, dateOfBirth: null });
    expect(got?.address).toEqual({ line1: null, line2: null, city: null, state: null, postalCode: null });
  });

  it("reads NONE and unavl as no value (§D.12.5)", () => {
    const got = parseAamvaBarcode(
      encode("636035", "10", [{ type: "DL", elements: [["DAQ", "J1"], ["DAD", "NONE"], ["DAH", "unavl"]] }]),
    );
    expect(got).toMatchObject({ middleName: null, address: { line2: null } });
  });

  it("takes an element's first value when a barcode repeats it", () => {
    const got = parseAamvaBarcode(encode("636035", "10", [{ type: "DL", elements: [["DAQ", "FIRST"], ["DAQ", "SECOND"]] }]));
    expect(got?.licenceNumber).toBe("FIRST");
  });
});

describe("what is not a licence barcode", () => {
  it.each([
    ["an empty read", ""],
    ["a QR code's URL", "https://example.com/apply"],
    ["a header cut inside the IIN", "@\n\u001e\rANSI 6360"],
    ["no compliance indicator", "X\n\u001e\rANSI 636035100001DL00310010DLDAQJ1\r"],
    ["a non-numeric entry count", "@\n\u001e\rANSI 6360351000XXDL00310010DLDAQJ1\r"],
  ])("refuses %s", (_label, raw) => {
    expect(parseAamvaBarcode(raw)).toBeNull();
  });

  it("refuses a barcode whose only subfile is the jurisdiction's own", () => {
    expect(parseAamvaBarcode(encode("636035", "10", [{ type: "ZI", elements: [["ZIA", "X"]] }]))).toBeNull();
  });

  it("refuses a card subfile that says nothing the form uses", () => {
    expect(parseAamvaBarcode(encode("636035", "10", [{ type: "DL", elements: [["DAY", "BRO"], ["DAU", "068 in"]] }]))).toBeNull();
  });
});

describe("dates (Table D.3: MMDDCCYY for the U.S., CCYYMMDD for Canada)", () => {
  it.each([
    ["06061986", "1986-06-06"],
    ["19860606", "1986-06-06"],
    ["02292024", "2024-02-29"],
    ["20240229", "2024-02-29"],
  ])("reads %s as %s", (raw, iso) => {
    expect(aamvaDate(raw)).toBe(iso);
  });

  it.each([["02302024"], ["13012024"], ["00012024"], ["20241301"], ["0606198"], ["06O61986"], ["02292023"]])(
    "refuses %s",
    (raw) => {
      expect(aamvaDate(raw)).toBeNull();
    },
  );
});
