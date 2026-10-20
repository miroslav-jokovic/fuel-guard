import { describe, expect, it } from "vitest";
import { foldUnitNumber, proposeFileSubject, type MatchRoster, type PaperIdentifiers } from "./fileSubjectMatch.js";

/**
 * UF7b's matcher. Each case is a way a bulk upload files a paper on the wrong subject: a weaker
 * identifier overruling a stronger one, a first-of-two guess, a filename treated as a fact, a scoped
 * drop silently moved.
 */
const roster: MatchRoster = {
  units: [
    { type: "tractor", id: "t654", unitNumber: "654", vin: "1XKYD49X0LJ123456", plate: "P-1234", plateState: "IL" },
    { type: "tractor", id: "t700", unitNumber: "700", vin: "3AKJHHDR5NSAB0001", plate: "P1234", plateState: "WI" },
    // A tractor and a trailer wearing one number — the tie a filename may break.
    { type: "tractor", id: "t812", unitNumber: "812", vin: null, plate: null, plateState: null },
    { type: "trailer", id: "r812", unitNumber: "812", vin: null, plate: null, plateState: null },
    { type: "trailer", id: "rR0532", unitNumber: "R0532", vin: null, plate: null, plateState: null },
  ],
  drivers: [
    { id: "d1", fullName: "Marcus Reyes", cdlNumber: "R123-4567-8901" },
    { id: "d2", fullName: "Jose Garcia", cdlNumber: "G1" },
    { id: "d3", fullName: "Jose  Garcia", cdlNumber: "G2" },
  ],
};

const paper = (over: Partial<PaperIdentifiers> = {}): PaperIdentifiers => ({
  vins: [], plates: [], unitNumbers: [], cdlNumber: null, driverName: null, filename: null, ...over,
});

describe("proposeFileSubject — units", () => {
  it("a VIN beats a unit number that names a different truck", () => {
    const out = proposeFileSubject(paper({ vins: ["1xkyd49x0lj123456 "], unitNumbers: ["700"] }), roster);
    expect(out).toMatchObject({ subject: { type: "tractor", id: "t654" }, basis: "vin", reason: "matched" });
  });

  it("a VIN that is not 17 characters is not a VIN, even when a roster row was typed the same way", () => {
    const typo: MatchRoster = { units: [{ type: "tractor", id: "x", unitNumber: "1", vin: "1XKYD49X0LJ12345", plate: null, plateState: null }], drivers: [] };
    expect(proposeFileSubject(paper({ vins: ["1XKYD49X0LJ12345"] }), typo).reason).toBe("no_candidate");
  });

  it("a plate needs its state when the plate alone is on two trucks", () => {
    expect(proposeFileSubject(paper({ plates: [{ number: "P 1234", state: null }] }), roster).reason).toBe("ambiguous");
    expect(proposeFileSubject(paper({ plates: [{ number: "P 1234", state: "wi" }] }), roster).subject).toEqual({ type: "tractor", id: "t700" });
  });

  it("folds leading zeros on a unit number, and only leading zeros", () => {
    expect(proposeFileSubject(paper({ unitNumbers: ["0654"] }), roster).subject).toEqual({ type: "tractor", id: "t654" });
    expect(foldUnitNumber("R0532")).toBe("R0532");
    expect(foldUnitNumber("000")).toBe("0");
    expect(proposeFileSubject(paper({ unitNumbers: ["R532"] }), roster).reason).toBe("no_candidate");
  });

  it("a number on a tractor and a trailer proposes nobody, unless the filename names exactly one", () => {
    expect(proposeFileSubject(paper({ unitNumbers: ["812"] }), roster)).toMatchObject({ subject: null, reason: "ambiguous" });
    // Both are unit 812, so a filename saying 812 still cannot choose.
    expect(proposeFileSubject(paper({ unitNumbers: ["812"], filename: "812-reg.pdf" }), roster).reason).toBe("ambiguous");
  });

  it("a filename is a tie-breaker only, never a match on its own", () => {
    expect(proposeFileSubject(paper({ filename: "654-registration.pdf" }), roster).reason).toBe("no_identifiers");
  });

  it("a filename breaks a tie an identifier left between two different units", () => {
    const out = proposeFileSubject(paper({ plates: [{ number: "P1234", state: null }], filename: "654-registration.pdf" }), roster);
    expect(out).toMatchObject({ subject: { type: "tractor", id: "t654" }, basis: "filename", reason: "matched" });
  });

  it("a paper listing several units proposes all of them, and names what it could not place", () => {
    const out = proposeFileSubject(paper({ unitNumbers: ["654", "700", "999"] }), roster);
    expect(out.subject).toBeNull();
    expect(out.units).toEqual([{ type: "tractor", id: "t654" }, { type: "tractor", id: "t700" }]);
    expect(out.unresolved).toEqual(["999"]);
  });

  it("two identifiers naming the same truck are one truck", () => {
    expect(proposeFileSubject(paper({ unitNumbers: ["654", "0654"] }), roster).subject).toEqual({ type: "tractor", id: "t654" });
  });

  it("an ambiguous strong identifier is not overruled by a weaker one", () => {
    const out = proposeFileSubject(paper({ plates: [{ number: "P1234", state: null }], unitNumbers: ["654"] }), roster);
    expect(out).toMatchObject({ subject: null, reason: "ambiguous", basis: "plate" });
  });
});

describe("proposeFileSubject — drivers", () => {
  it("a CDL number names the driver, however it is punctuated", () => {
    expect(proposeFileSubject(paper({ cdlNumber: "r12345678901" }), roster)).toMatchObject({ subject: { type: "driver", id: "d1" }, basis: "cdl" });
  });

  it("two drivers with the same name propose nobody", () => {
    expect(proposeFileSubject(paper({ driverName: "jose garcia" }), roster)).toMatchObject({ subject: null, reason: "ambiguous", basis: "name" });
  });

  it("a CDL number decides between two drivers of one name", () => {
    expect(proposeFileSubject(paper({ driverName: "Jose Garcia", cdlNumber: "G2" }), roster).subject).toEqual({ type: "driver", id: "d3" });
  });

  it("a paper with nothing to go on says so", () => {
    expect(proposeFileSubject(paper(), roster).reason).toBe("no_identifiers");
  });
});

describe("proposeFileSubject — a scoped drop", () => {
  it("fixes the subject, with no warning when the paper agrees or names nobody", () => {
    expect(proposeFileSubject(paper({ unitNumbers: ["654"] }), roster, { type: "tractor", id: "t654" }))
      .toMatchObject({ subject: { type: "tractor", id: "t654" }, basis: "scope", contradicts: null });
    expect(proposeFileSubject(paper(), roster, { type: "tractor", id: "t654" }).contradicts).toBeNull();
  });

  it("keeps the dropped-on unit and warns when the paper names another", () => {
    const out = proposeFileSubject(paper({ vins: ["3AKJHHDR5NSAB0001"] }), roster, { type: "tractor", id: "t654" });
    expect(out.subject).toEqual({ type: "tractor", id: "t654" });
    expect(out.contradicts).toEqual({ type: "tractor", id: "t700" });
  });
});
