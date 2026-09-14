import { describe, it, expect } from "vitest";
import { AUTHORIZATION_PURPOSES } from "@silvicom/shared";
import { normaliseWorkbookLine, workbookLines } from "../../testing/packetWorkbook.js";
import {
  PACKET_INSTRUMENTS,
  PACKET_WORDING_INSTRUMENTS,
  WORDING_LEFT_ALONE,
  WORDING_SPELLING_REPAIRS,
  WORDING_TYPOGRAPHY_REPAIRS,
  packetWording,
  repair,
} from "./packetWording.js";

/**
 * The carrier's own instruments, checked against the workbook they were transcribed from.
 *
 * ── WHAT THIS FILE IS DEFENDING ───────────────────────────────────────────────────────────────
 * What gets published here is the text a driver legally signs. The transcription is an engineer's
 * typing of a lawyer's document, and there is exactly one way to stop that being a problem: re-read
 * `APPLICATION.xlsx` and fail the build when the two disagree. `packetStatic.test.ts` made that
 * argument for the printed pages in P3; the argument is stronger here, because these words end up in
 * `driver_authorizations.disclosure_text` where they are evidence.
 *
 * ⚠ **And a second thing, which is the one that would rot quietly: the repairs.** A register that
 * silently grew an entry changing a clause would be indistinguishable from one fixing a typo. The
 * word-count guard below is what makes "spelling only" a fact rather than a promise.
 */

const lines = workbookLines().map(normaliseWorkbookLine);
const haystack = lines.join("\n");

/** Every transcribed line, flattened — heading, body and the affirmation. */
const everyLine = PACKET_INSTRUMENTS.flatMap((i) => [
  i.heading,
  ...i.paragraphs.flat(),
  ...i.intent,
]);

describe("the carrier's packet as a source of published wording", () => {
  it("can read the workbook at all", () => {
    // Guards the guard: an unreadable archive makes every comparison below vacuously true.
    expect(lines.length).toBeGreaterThan(700);
    expect(haystack).toContain("FAIR CREDIT REPORTING ACT DISCLOSURE");
  });

  /**
   * ⚠ The assertion this file exists for. Compared as substrings of a normalised row, because a
   * spreadsheet row is cells joined by a separator and a transcribed line is one cell out of it.
   */
  it("every transcribed line is really in the carrier's workbook", () => {
    const missing = everyLine.filter((l) => !haystack.includes(normaliseWorkbookLine(l)));
    expect(missing).toEqual([]);
  });

  it("transcribes 52 lines across the three instruments — nothing was quietly dropped", () => {
    // A transcription that lost a clause would still satisfy the assertion above, because what
    // remained would still be found in the source. Only a count can see a deletion.
    expect(everyLine).toHaveLength(52);
  });
});

/**
 * ⚠ The register's own rule, enforced rather than asserted in prose.
 *
 * `packetText.ts` set it for the printed packet: a spelling repair's two halves differ only in the
 * spelling of a word, so the WORD COUNT may not change. It is the one cheap check that catches a
 * dropped clause or an inserted qualifier wearing a typo fix as a disguise.
 */
describe("the repair registers", () => {
  const words = (s: string): number => s.trim().split(/\s+/).length;

  it("makes only spelling repairs in the spelling register — no entry changes the word count", () => {
    const changed = WORDING_SPELLING_REPAIRS.filter((r) => words(r.packet) !== words(r.corrected));
    expect(changed).toEqual([]);
  });

  it("every repair, in both registers, actually occurs in the workbook", () => {
    const absent = [...WORDING_SPELLING_REPAIRS, ...WORDING_TYPOGRAPHY_REPAIRS]
      .filter((r) => !haystack.includes(normaliseWorkbookLine(r.packet)))
      .map((r) => r.packet);
    // A register entry matching nothing is either a repair already made silently upstream or a
    // guess about a defect that is not there. Both are worth failing for.
    expect(absent).toEqual([]);
  });

  it("makes every typography repair argue for itself", () => {
    for (const r of WORDING_TYPOGRAPHY_REPAIRS) expect(r.why.length).toBeGreaterThan(40);
  });

  /**
   * ⚠ The citation repair, pinned on its own because it is the only entry that alters a statutory
   * reference. `15 U.S.C. 1681-168lu` is an OCR failure — a lower-case L for a 1 — and `168lu`
   * cites nothing. If this ever needs reverting, it reverts here and in the review document.
   */
  it("repairs the FCRA citation, and says so out loud", () => {
    const fcra = packetWording("fcra_disclosure")!;
    expect(fcra.body).toContain("15 U.S.C. 1681-1681u");
    expect(fcra.body).not.toContain("168lu");
  });

  it("leaves every recorded uncertainty exactly as the carrier wrote it", () => {
    // The other half of the discipline: what we chose NOT to guess at must still be there.
    const composed = PACKET_WORDING_INSTRUMENTS
      .map((i) => { const w = packetWording(i)!; return `${w.title}\n${w.body}\n${w.intent}`; })
      .join("\n");
    const repaired = WORDING_LEFT_ALONE.filter((u) => !composed.includes(u.text));
    expect(repaired).toEqual([]);
  });
});

describe("what gets published", () => {
  it("carries no known corruption into the text a driver signs", () => {
    const composed = PACKET_WORDING_INSTRUMENTS
      .map((i) => { const w = packetWording(i)!; return `${w.title}\n${w.body}\n${w.intent}`; })
      .join("\n");
    for (const bad of ["emplyer", "emplyment", "infromation", "ahuthorize", "certy", "paragrafs", "€", "T he ", "applicanthas", "howerver", "requlated", "preivious"]) {
      expect(composed).not.toContain(bad);
    }
  });

  it("collapses the spreadsheet's wrapping without moving a character", () => {
    const prev = packetWording("previous_employer")!;
    // The workbook breaks this sentence across two cells mid-clause; a reader must not see the seam.
    expect(prev.body).toContain("in connection with my application for employment with SILVICOM INC");
    expect(prev.body).not.toMatch(/ {2}/);
    // Paragraphs are separated by a blank line and nothing else carries a newline: the workbook's
    // mid-sentence cell breaks must not survive into the text somebody signs.
    expect(prev.body.split("\n\n").join("")).not.toContain("\n");
  });

  it("keeps the six §391.23(d)/(e) due-process rights the page grants", () => {
    const prev = packetWording("previous_employer")!;
    expect(prev.body).toContain("paragraphs (d) and (e) of Section 391.23");
    expect(prev.body).toContain("The right to review information provided by previous employers");
    expect(prev.body).toContain("rebuttal statement attached to the alleged erroneous information");
    expect(prev.body).toContain("within 5 business days");
  });

  it("takes the carrier's own affirmation as the intent, never one of ours", () => {
    expect(packetWording("fcra_disclosure")!.intent).toBe(
      "I hereby authorize SILVICOM, INC to obtain consumer reports for the purpose of conducting"
      + " background investigations for employment/contract purposes.",
    );
    expect(packetWording("drug_alcohol")!.intent).toContain(
      "my written authorization is required in order for the result of this testing",
    );
  });

  it("names the page a reviewer holds in their hand", () => {
    expect(packetWording("fcra_disclosure")!.page).toBe(19);
    expect(packetWording("previous_employer")!.page).toBe(14);
    expect(packetWording("drug_alcohol")!.page).toBe(21);
  });
});

/**
 * ⚠ **The gap, pinned — because it is the finding, not an omission.**
 *
 * The packet answers for three of the instruments the applicant signs and has nothing at all for
 * `psp`. Searched across every string in the workbook: no Pre-Employment Screening Program, no
 * MCMIS, no §382.701, no Clearinghouse. The 7001(c) electronic-records consent could not be there —
 * it exists because the driver signs on a phone.
 *
 * This test fails the day somebody adds a fourth entry without also answering the question in
 * `WORDING-REVIEW-2026-09-13.md` §3, which is the point: it should not be possible to quietly
 * decide that a PSP authorization the carrier's lawyers never wrote is fine.
 */
describe("what the packet does NOT contain", () => {
  it("has no PSP authorization, and none of the applicant's four may be assumed", () => {
    expect(PACKET_WORDING_INSTRUMENTS).toEqual(["fcra_disclosure", "previous_employer", "drug_alcohol"]);
    expect(PACKET_WORDING_INSTRUMENTS).not.toContain("psp");
  });

  it("really has nothing to transcribe for it — searched, not assumed", () => {
    const hay = haystack.toLowerCase();
    for (const absent of ["pre-employment screening program", "mcmis", "382.701", "clearinghouse"]) {
      expect(hay).not.toContain(absent);
    }
  });

  it("covers every purpose it claims to, and only real ones", () => {
    for (const i of PACKET_WORDING_INSTRUMENTS) {
      expect([...AUTHORIZATION_PURPOSES, "esign_consent"]).toContain(i);
    }
  });

  /**
   * ⚠ Page 18 IS an MVR authorization and is transcribed nowhere, because there is no instrument to
   * put it in: `AUTHORIZATION_PURPOSES` has no `mvr`. The carrier's lawyers wrote a release this
   * product cannot hold. Asserted so the absence stays deliberate.
   */
  it("leaves the driving-record authorization out, because nothing can hold it", () => {
    expect(haystack).toContain("AUTHORIZATION FOR DRIVING RECORD CHECK");
    expect(AUTHORIZATION_PURPOSES).not.toContain("mvr" as never);
    const composed = PACKET_WORDING_INSTRUMENTS.map((i) => packetWording(i)!.body).join("\n");
    expect(composed).not.toContain("AUTHORIZATION FOR DRIVING RECORD CHECK");
  });
});

describe("repair()", () => {
  it("is a no-op on text carrying none of the packet's defects", () => {
    expect(repair("Plain text with nothing wrong in it.")).toBe("Plain text with nothing wrong in it.");
  });
});
