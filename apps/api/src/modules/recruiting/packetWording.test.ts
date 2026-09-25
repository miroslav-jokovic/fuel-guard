import { describe, it, expect } from "vitest";
import { AUTHORIZATION_PURPOSES, PACKET_PLACEMENTS } from "@silvicom/shared";
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

  it("transcribes 57 lines across the four instruments — nothing was quietly dropped", () => {
    // A transcription that lost a clause would still satisfy the assertion above, because what
    // remained would still be found in the source. Only a count can see a deletion.
    expect(everyLine).toHaveLength(57);
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

  /**
   * ⚠ **This replaces an assertion that could not fail, and had been passing over a wrong answer.**
   *
   * It read `expect(packetWording("fcra_disclosure")!.page).toBe(19)` — the constant restated. Every
   * page number in `packetWording.ts` was one too low (see the `page` field's own comment for the
   * measurement), and thirty-three wrong numbers sat under a green test for as long as the test only
   * ever asked the file what the file said.
   *
   * `PACKET_PLACEMENTS` is the cross-check because it was measured SEPARATELY and from the other
   * direction: each entry carries the workbook line its signature sits on, and `packetPlacements.test.ts`
   * re-reads `APPLICATION.xlsx` to prove the line is there. An instrument the applicant signs must
   * therefore be on a page that inventory says carries a driver signature — which 15, 20 and 22 do,
   * and which 14 and 21 do not: p14 is the verification request the CARRIER sends (§2.4 of the plan)
   * and p21 is the Seven Day Work Statement, which left the packet under D-PKT7.
   *
   * ⚠ **It would not have caught the third one.** p19 carries two driver signatures, so `fcra_disclosure`
   * at 19 passes this check while being wrong. Stated rather than papered over: the check that closes
   * it reads the footers out of the carrier's PDF, and needs that PDF in the repository.
   */
  it("puts every published instrument on a page the placement inventory says a driver signs", () => {
    const driverSignsOn = new Set(
      PACKET_PLACEMENTS.filter((p) => p.party === "driver" && p.mark === "signature").map((p) => p.page),
    );
    for (const instrument of PACKET_WORDING_INSTRUMENTS) {
      const doc = packetWording(instrument);
      expect(doc, instrument).not.toBeNull();
      expect(driverSignsOn, `${instrument} is published as packet page ${doc!.page}`).toContain(
        doc!.page,
      );
    }
  });

  /**
   * The repair registers name pages too, and they drifted together with the instruments — nineteen
   * spelling entries, four typography entries and seven left-alone entries, all one low. Nothing
   * cross-checks a repair's page against a second source the way the instruments' can be, so what is
   * pinned instead is the weaker true thing: a repair belongs to a page one of the three published
   * instruments is on, because those are the only pages this module transcribes.
   */
  it("keeps every recorded repair on a page this module actually transcribes", () => {
    const transcribed = new Set(PACKET_INSTRUMENTS.map((i) => i.page));
    for (const entry of [
      ...WORDING_SPELLING_REPAIRS,
      ...WORDING_TYPOGRAPHY_REPAIRS,
      ...WORDING_LEFT_ALONE,
    ]) {
      const shown = "packet" in entry ? entry.packet : entry.text;
      expect(transcribed, `page ${entry.page}: ${shown}`).toContain(entry.page);
    }
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
 * ⚠ PSP is now served from `pspDisclosure.ts` instead, because FMCSA mandates its own language and
 * there was never anything for the carrier to draft. That is exactly why this test stays: the
 * instruments must not silently migrate between the two modules. What Silvicom's lawyers wrote
 * lives here; what the regulator wrote lives there; and a PSP entry appearing in THIS list would
 * mean somebody had put words in the carrier's mouth that FMCSA requires to be its own.
 */
describe("what the packet does NOT contain", () => {
  it("has no PSP authorization, and none of the applicant's other permissions may be assumed", () => {
    expect(PACKET_WORDING_INSTRUMENTS).toEqual(["fcra_disclosure", "previous_employer", "drug_alcohol", "mvr"]);
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
   * ⚠ Page 19 IS the MVR authorization, and until 2026-09-25 it was transcribed nowhere because
   * `AUTHORIZATION_PURPOSES` had no `mvr` to hold it. D-MVR1 made it a permission. What is pinned now
   * is that it is published from the carrier's own page and nothing else: the heading is theirs, both
   * sentences are theirs, and the sentence that stops mid-clause still stops there (Q-MVR1).
   */
  it("publishes the driving-record authorization from page 19, as the carrier wrote it (D-MVR1)", () => {
    const mvr = packetWording("mvr")!;
    expect(mvr.page).toBe(19);
    expect(mvr.title).toBe("AUTHORIZATION FOR DRIVING RECORD CHECK");
    expect(mvr.body).toBe(
      "By signing below I authorize you to release the information requested to SILVICOM, INC as "
      + "directed by the Federal Motor Carrier Safety Administration Regulations.",
    );
    expect(mvr.intent).toBe(
      "I hereby release you from any liability which might be the result of providing this",
    );
  });
});

describe("repair()", () => {
  it("is a no-op on text carrying none of the packet's defects", () => {
    expect(repair("Plain text with nothing wrong in it.")).toBe("Plain text with nothing wrong in it.");
  });
});
