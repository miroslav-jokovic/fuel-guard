import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { crossMatchEmployment, parsePspReport } from "@fuelguard/shared";

/**
 * The fourteen real PSP responses, replayed.
 *
 * ── WHY THESE ARE COMMITTED WHOLE ──────────────────────────────────────────────────────────────
 * Every fixture in `__fixtures__/uat/` is the verbatim body PSP returned for one of the workbook's
 * synthetic test drivers on 2026-08-20 (UAT, motorCarrierId 31496), with only `authCode` and
 * `authCodeURL` redacted — those retrieve a PDF for 120 hours, and a committed fixture is the wrong
 * home for anything that authenticates. Roughly 88% of the fields are ones the parser never reads,
 * and they are kept ON PURPOSE: a fixture trimmed to what the code reads today can never catch what
 * the code fails to read tomorrow, which is precisely the defect the first real response exposed —
 * dates arrived `MMDDYYYY`, were passed straight through, and silently broke every employment
 * cross-match while a suite of hand-built ISO fixtures stayed green.
 *
 * It lives in `apps/api` rather than beside the parser because `packages/shared` is pure domain
 * logic with no Node types — it is consumed by React Native — and a suite that reads the filesystem
 * does not belong there. The vendor edge is this package's job.
 *
 * These assert INVARIANTS across all fourteen rather than golden-mastering each one. A snapshot
 * would pin the projection including whatever it currently gets wrong; these pin properties the
 * vendor's own shapes must satisfy, so a parser that quietly stops reading a field fails here even
 * though nobody wrote a case about that field.
 *
 * Re-capture with `pnpm --filter @fuelguard/api psp:uat --driver <name> --order`. UAT does not bill.
 */

interface VendorRecord {
  driverLicenseNumber?: string | null;
  driverLicenseState?: string | null;
  censusNumber?: string | null;
  uploadDOTNumber?: string | null;
  usdotNumber?: string | null;
}
interface VendorInfo {
  internalRefId?: string;
  driverRecord: { inspectionRecords: VendorRecord[]; crashRecords: VendorRecord[] };
}

const dir = path.join(import.meta.dirname, "__fixtures__/uat");
const drivers = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));

const load = (driver: string): unknown[] =>
  JSON.parse(readFileSync(path.join(dir, `${driver}.json`), "utf8")) as unknown[];
const element = (raw: unknown[]): Record<string, unknown> => raw[0] as Record<string, unknown>;
const info = (raw: unknown[]): VendorInfo => element(raw).driverInformationResponse as VendorInfo;
const report = (driver: string) => parsePspReport(element(load(driver)));

const ISO = /^\d{4}-\d{2}-\d{2}$/;

describe("the fourteen UAT responses, replayed", () => {
  it("captured every driver in the workbook", () => {
    expect(drivers).toHaveLength(14);
  });

  for (const driver of drivers) {
    it(`${driver} parses as a billable success with its evidence intact`, () => {
      const raw = load(driver);
      const r = parsePspReport(element(raw));
      const src = info(raw);

      expect(r.outcome).toBe("success");
      expect(r.status).toBe(0);
      expect(r.billed).toBe(true);
      expect(r.internalRefId).toBe(src.internalRefId);
      // ONE response for the whole request, not one per licence. Thomas asked with two and got one,
      // so reading `[0]` drops nothing.
      expect(raw).toHaveLength(1);
      expect(r.inspections).toHaveLength(src.driverRecord.inspectionRecords.length);
      expect(r.crashes).toHaveLength(src.driverRecord.crashRecords.length);
    });
  }

  /**
   * The regression that cost the most to find. PSP sends `MMDDYYYY`; everything downstream compares
   * these against ISO, and a string comparison between the two formats is false for every real value
   * — `"03072024" >= "2023-01-01"` is false because `0` sorts before `2`.
   */
  it("projects every date as ISO, across all 47 of them", () => {
    let checked = 0;
    for (const driver of drivers) {
      const r = report(driver);
      for (const i of r.inspections) {
        if (i.inspectionDate) {
          expect(i.inspectionDate).toMatch(ISO);
          checked++;
        }
      }
      for (const c of r.crashes) {
        if (c.reportDate) {
          expect(c.reportDate).toMatch(ISO);
          checked++;
        }
      }
    }
    expect(checked).toBe(47);
  });

  /**
   * A crash record has NO `usdotNumber` key — confirmed across all fourteen real crashes. The carrier
   * is in `censusNumber`, falling back to `uploadDOTNumber`. Reading the obvious name would have made
   * every crash carrier null, and null carriers are deliberately skipped downstream, so the damage
   * would have been invisible.
   */
  it("resolves the crash carrier from censusNumber, which is where it actually is", () => {
    const raw = load("litton");
    const src = info(raw).driverRecord.crashRecords;
    expect(src.every((c) => !("usdotNumber" in c))).toBe(true);
    parsePspReport(element(raw)).crashes.forEach((c, n) => {
      expect(c.usdotNumber).toBe(src[n]?.censusNumber ?? src[n]?.uploadDOTNumber ?? null);
    });
  });

  it("keeps both of Thomas's licences, tagged on the records themselves", () => {
    const licences = new Set(
      info(load("thomas")).driverRecord.inspectionRecords.map(
        (i) => `${i.driverLicenseNumber}/${i.driverLicenseState}`,
      ),
    );
    expect(licences).toEqual(new Set(["G12345678/GA", "P123456789/PA"]));
    expect(report("thomas").inspections).toHaveLength(7);
  });

  /**
   * Cases 88–91, "Carrier Information Unavailable" — and they are real: nine records across the set
   * carry a null USDOT, a null carrier name, or (Hines) both.
   *
   * The rule is that these are SKIPPED, never read as an employer the applicant failed to declare.
   * An inspection PSP cannot attribute is not evidence of undisclosed employment, and reporting it as
   * one would put a finding against a driver on the strength of a missing field.
   */
  it("never reports a carrier-less record as an undeclared employer", () => {
    let carrierless = 0;
    for (const driver of drivers) {
      const r = report(driver);
      carrierless += r.inspections.filter((i) => !i.usdotNumber).length;
      carrierless += r.crashes.filter((c) => !c.usdotNumber).length;

      const out = crossMatchEmployment({
        declared: [],
        declaredAccidents: [],
        inspections: r.inspections,
        crashes: r.crashes,
        ownDotNumber: null,
        asOf: "2026-08-20",
        pulledOn: "2026-08-20",
      });
      expect(out.unlisted.every((u) => Boolean(u.usdotNumber))).toBe(true);
    }
    expect(carrierless).toBeGreaterThan(0);
  });

  /**
   * The four jurisdictions `PSP_JURISDICTIONS` enumerates rather than length-checks. All four round-
   * tripped as `status: 0`, which is what makes the enumeration worth its length: a two-character
   * regex would have accepted these, and accepted a typo just as readily.
   */
  for (const [driver, state] of [["knoll", "NT"], ["cross", "ON"], ["hines", "GU"], ["carter", "VI"]]) {
    it(`${driver} round-trips the ${state} jurisdiction`, () => {
      expect(report(driver!).driverLicenseState).toBe(state);
    });
  }

  /**
   * §10.5 is NOT covered by this data, and saying so is the point.
   *
   * The workbook lists Barger and Litton as `notPreventable` crashes; all fourteen real crashes came
   * back with the field null. `flag()` reads that as false, which leaves the crash counted — the
   * cautious direction — but nothing here exercises the true branch. When this test fails, UAT has
   * gained the data and `crashesNotPreventable` can finally be proved rather than assumed.
   */
  it("has no notPreventable crash to exercise, and this is the tripwire for when it does", () => {
    const flagged = drivers.flatMap((d) => report(d).crashes.filter((c) => c.notPreventable));
    expect(flagged).toHaveLength(0);
  });
});
