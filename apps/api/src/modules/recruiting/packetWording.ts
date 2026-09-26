import type { PublishableInstrument } from "@silvicom/shared";
import { PACKET_SPELLING } from "./packetSpelling.js";

/**
 * The carrier's OWN instrument wording, transcribed from its packet (2026-09-13).
 *
 * ── WHY THIS EXISTS, AND WHAT IT REPLACES ─────────────────────────────────────────────────────
 * `authorizationContract.ts` holds six instruments and every one is `v0-draft` placeholder text an
 * ENGINEER wrote. `/settings/application-wording` (0338) lets a carrier publish its own text over
 * them, and the editor pre-fills with whatever is live — so pressing Publish on a fresh install
 * adopts OUR words.
 *
 * ⚠ **Silvicom's own text already exists and was written by their lawyers.**
 * `docs/plans/recruitment/APPLICATION.xlsx` is the carrier's 31-page packet, and four of its pages
 * are the same instruments the applicant signs on their phone. Publishing our placeholder beside
 * their paper packet would give one driver's file **two different texts for the same instrument**,
 * with nothing afterwards able to say which they read. This module is the other choice: the
 * applicant signs the carrier's words, because the carrier's words are the ones counsel wrote.
 *
 * ── WHY IT IS TRANSCRIBED RATHER THAN READ AT RUNTIME ─────────────────────────────────────────
 * The same decision `packetStatic.ts` made and for the same reason: the api does not parse a
 * spreadsheet on the applicant's page load, and a reviewer who is not an engineer has to be able to
 * read what will be published. The workbook stays the source of truth by TEST — `packetWording.test.ts`
 * re-reads `APPLICATION.xlsx` and fails if any line below is not in it, character for character
 * after trimming. So this is a measurement that rots loudly, not a copy.
 *
 * ── AND WHY NOTHING HERE PUBLISHES ITSELF ─────────────────────────────────────────────────────
 * ⚠ It is offered to the office as a starting draft and **nothing publishes without somebody
 * pressing Publish.** Adopting a legal instrument is the carrier's act, not a migration's. The
 * version is still assigned by `publishWording`, the row still lands in `org_disclosures`, and the
 * audit still names who did it — this only decides what is in the box before they read it.
 */

/**
 * ⚠ **Corruption left exactly as the carrier has it, because fixing it is not spelling.**
 *
 * Recorded rather than silently skipped: a missing word, a stray space or a full stop where a comma
 * belongs cannot be corrected without supplying wording, and a wording change to a signed instrument
 * is counsel's act. Each of these is a question for the review, not a fix.
 *
 * ⚠ Since D-PKT20 (2026-09-25) the spelling itself IS corrected — the owner said the packet was
 * retyped by their secretary — from the one register the printed page uses, `PACKET_SPELLING`. That
 * took two entries off this list: `with to review` (→ `wish`) and `they above` (→ `the`), both a
 * wrong word whose intended one the sentence settles.
 */
export const WORDING_LEFT_ALONE: readonly { page: number; text: string; question: string }[] = [
  {
    page: 15,
    text: "which may be done at any including when applying",
    question: "A word is missing after `at any` — `time`, on any sensible reading. We are not the ones to add it.",
  },
  {
    page: 15,
    text: "within 30 days SILVICOM INC making them available",
    question: "Reads as though `of` is missing after `days`.",
  },
  {
    page: 20,
    text: "may be used for employment /contract purposes",
    question:
      "A stray space before the slash. Repairing it would join two tokens into one and break the "
      + "word-count guard that makes every other repair on this page checkable.",
  },
  {
    page: 19,
    text: "which might be the result of providing this",
    question:
      "The sentence stops mid-clause — in the workbook AND in the carrier's PDF. `information` is "
      + "almost certainly the missing word, and it is inside the release of liability (Q-MVR1).",
  },
  {
    page: 22,
    text: "regarding pre-employment. contracted drivers / owners",
    question: "A full stop where a comma belongs. Punctuation is left alone throughout — see `packetText.ts`.",
  },
  {
    page: 22,
    text: "I have been informed and understand. that should controlled substance testing produce a positive result. it will",
    question: "Two more sentence-ending periods mid-clause. Same rule.",
  },
];

/** One instrument, as the packet has it. Lines are workbook cells, trimmed and nothing else. */
export interface PacketInstrumentSource {
  instrument: PublishableInstrument;
  /**
   * The carrier's own page number, from the footer — where a reviewer finds it on paper.
   *
   * ⚠ **Every number in this file was one too low until 2026-09-14, and the test said otherwise.**
   * The three instruments were recorded at 14 / 19 / 21; they are on 15 / 20 / 22. So were the four
   * `WORDING_TYPOGRAPHY_REPAIRS`, the nineteen `WORDING_SPELLING_REPAIRS` (both since folded into
   * `PACKET_SPELLING`, D-PKT20) and the seven
   * `WORDING_LEFT_ALONE` entries, and three page references in the prose. Thirty-three numbers, all
   * off by exactly one, sending a reviewer holding the paper to the page before the one they want —
   * and `page 19` is a real page carrying a real instrument (`AUTHORIZATION FOR DRIVING RECORD
   * CHECK`), so the wrong number does not announce itself by landing on something blank.
   *
   * **Measured, not re-counted.** `pdftotext -layout` over the carrier's `Application 11.pdf`,
   * reading the number printed in each page's own footer beneath `THIS IS NOT AN EMPLOYMENT
   * APPLICATION`. That footer number equals the PDF page index on all 31 pages, so either reading
   * gives the same answer — which is what makes the old numbers a transcription slip rather than a
   * disagreement about which numbering to use. Spot-checked per instrument against its heading
   * (`PAST EMPLOYMENT VERIFICATION` p15, `FAIR CREDIT REPORTING ACT DISCLOSURE` p20,
   * `URINALYSIS NOTIFICATION` p22) and per repair against its own fragment (`applicanthas` p15,
   * `168lu` p20, `pre-employment. contracted` p22).
   *
   * ⚠ **The workbook cannot check this and never could.** `APPLICATION.xlsx` stores no page breaks,
   * which is why `packetPlacements.ts` records the footer number by hand too — so the test that
   * "named the page a reviewer holds in their hand" could only assert the constant against itself,
   * and it passed for as long as the constant was wrong. What replaces it cross-checks against
   * `PACKET_PLACEMENTS`, which is anchored to workbook lines and was measured separately; that
   * catches a page carrying no driver signature at all, which is what 14 and 21 were. It does NOT
   * catch a slide onto another signing page, and the check that would — reading the footers out of
   * the carrier's PDF — needs that PDF in the repository, which arrives with the overlay template.
   */
  page: number;
  /** The workbook's heading cell. Becomes the published title. */
  heading: string;
  /** The body, as paragraphs of workbook lines. */
  paragraphs: readonly (readonly string[])[];
  /** The sentence the signer affirms — also the carrier's own words, not ours. */
  intent: readonly string[];
}

/**
 * The four instruments the packet actually contains, mapped to what the applicant signs.
 *
 * ⚠ **Four, not seven** — four since D-MVR1 added page 19. `psp` and `clearinghouse` do not
 * appear in this packet in any form — no Pre-Employment Screening Program, no MCMIS, no §382.701, searched across all 697 of the
 * workbook's strings. The 7001(c) electronic-records consent is not there either, and could not be:
 * it exists because the driver signs on a phone, which a paper packet never contemplated.
 *
 * ⚠ **PSP's absence turned out not to be a gap at all** — see `pspDisclosure.ts`. FMCSA publishes
 * the disclosure and requires account holders to use it "in whole, exactly as provided", so there
 * was never anything for the carrier's lawyers to draft. It is served from there rather than from
 * here precisely because it is not the carrier's text: this module is what Silvicom wrote, and that
 * one is what the regulator wrote.
 *
 * ⚠ **Page 19's `AUTHORIZATION FOR DRIVING RECORD CHECK` is transcribed since 2026-09-25 (D-MVR1).**
 * Until then it sat outside this list on purpose — the MVR authorization with no instrument to be
 * published into, because `AUTHORIZATION_PURPOSES` had no `mvr`. The owner ruled that it moves out
 * of the application and is signed as a permission like the other five
 * (`MVR-RELEASE-AND-TEMPLATES-PLAN.md`), and page 19's two driver lines are withdrawn from packet
 * signing (`PACKET_WITHDRAWALS`) so nobody signs the same release twice.
 */
export const PACKET_INSTRUMENTS: readonly PacketInstrumentSource[] = [
  {
    instrument: "fcra_disclosure",
    page: 20,
    heading: "FAIR CREDIT REPORTING ACT DISCLOSURE",
    /**
     * ⚠ Page 20 ALONE, deliberately. Page 4's `Independent Contractor Notification & Release` is
     * also a consumer-report disclosure, and it is not merged in here: it combines the disclosure
     * with a general liability release and an ongoing procurement authorization, which is the exact
     * combination FCRA §604(b)(2) forbids by requiring a document that consists SOLELY of the
     * disclosure. Merging them would import that problem into the one instrument built to avoid it.
     * Page 4 is raised in the review instead.
     */
    paragraphs: [[
      "The Federal Motor Carrier Safety Regulations (FMCSR) require motor carriers to investigate the",
      "employment background, drug and alcohol testing history, and motor vehicle driving record of all",
      "commercial motor vehicle driver applicants. T he purpose of this disclosure, in accordance with",
      "Section 604(b) of the Fair Credit Reporting Act (15 U.S.C. 1681-168lu), is to inform you that consumer",
      "reports may be used for employment /contract purposes to complete these and other background",
      "investigations.",
    ]],
    intent: [
      "I hereby authorize SILVICOM, INC to obtain consumer reports for the purpose of conducting",
      "background investigations for employment/contract purposes.",
    ],
  },
  {
    instrument: "previous_employer",
    page: 15,
    heading: "PAST EMPLOYMENT VERIFICATION",
    paragraphs: [
      [
        "1. I hereby ahuthorize the above mentioned emplyer/school to release all information as to my  character, work habits,",
        "performance, experience, fitness together with reasons for termination concerning my employment to SILVICOM INC",
        "( or their authorized agents) which may request such information in connection with my application  for emplyment with",
        "SILVICOM INC",
      ],
      [
        "2. In conformity with 49 CFR part 40, I hereby authorize the above mentioned emplyer/school and their agents to furnish SILVICOM",
        "INC they above requested information concerning DOT drug and alcohol testing including pre employment test during the previous",
        "3 years, the dates when  I tested positive, the dates when  I tested 0.04 or greater, the dates when I refused ( including",
        "a verified adultered or substituted result) to be tested for drugs and alcohol, and any other violations of 49 CFR part 40 and",
        "any information the above mentioned employer/school  and/or their  authorized agents have received  regarding violations",
        "of 49 CFR part 40 from my preivious employers  covered by DOT.",
      ],
      [
        "3. I hereby release the above mentioned emplyer/school and their authorized agents from any and all liability of any type as a",
        "result of providing the above requested information to SILVICOM INC.",
      ],
      [
        "It is expressly acknowledged, understood and agreed that the information provided by the applicant regarding the applicant's",
        "employment during the prvious 3 years in accordance with section 391.21(b)(10) of the FMCSR may be used, and the applicant's",
        "prior emloyers may be contacted, for the purpose of investigating the applicant's safety performance history as required by",
        "paragrafs (d) and € of Section 391.23 of the FMCSR. The applicanthas certain due process rights under the FMCSR regarding",
        "the information received as a result of these investigations as described below",
      ],
      [
        "1. The right to review information provided by previous emplyers.  2. The right to have errors in information corrected",
        "by the previous employer and for the previous employer to re-send the  corrected information to SILVICOM INC and",
        "3. The right to have a rebuttal statement attached to the alleged erroneous information.",
      ],
      [
        "Drivers who have previous DOT requlated employment history in the preceding 3 years, and with to review previous employer",
        "provided investigative information, must submit a written request to the Safety manager of Silvicom Inc which may be done at any",
        "including when applying, or as late as 30 days after being emplyed or being notified of denial of emplyment  SILVICOM INC",
        "will provide this infromation to the applicant within 5 business days after receiving the written request. If, howerver, SILVICOM",
        "INC has not yer received the requested infromation form previous emplyer(s),  then it will provide the information to the",
        "applicant within 5 business days after it receives the requested safety performance history information. If the driver has not",
        "arranged to receive the requested records withing 30 days SILVICOM INC making them available, SILVICOM INC  will consider the",
        "driver to have waived the request to review the records.",
      ],
    ],
    intent: [
      "By signing below, I certy that I have read and fully understand all parts of this release and that I  executed this release voluntarily,",
      "with the knowledge that any and all information released could affect me  being employed with SILVICOM INC",
    ],
  },
  {
    instrument: "drug_alcohol",
    page: 22,
    heading: "URINALYSIS NOTIFICATION",
    /**
     * ⚠ The page's `This test is required for:` tick-boxes (Pre-Employment Qualification /
     * Suspicion of Controlled Substance / Pre-Qualification for Contracting / Other) are NOT
     * transcribed. They are a form control the office completes, not prose the driver agrees to,
     * and a published `body` is a block of text with nothing to tick.
     */
    paragraphs: [
      [
        "Part 382 of the Federal Motor Carrier Safety Regulations, regarding pre-employment. contracted",
        "drivers / owners, random testing for controlled substance applies to all applicants",
        "seeking employment or to be contracted with any Motor Carrier in the U. S. A.",
      ],
      [
        "By signing below. I agree, as a condition of my Pre-Qualification, to the collection of a urine sample",
        "and to the testing for controlled substances. I have been informed and understand. that should",
        "controlled substance testing produce a positive result. it will medically disqualify me from operating",
        "commercial vehicle for this company. The medical Review Officer will keep the results of urinalysis",
        "testing and report positive and negative test results to the company.",
      ],
    ],
    intent: [
      "I have read and fully understand the conditions above regarding urinalysis notification. I also",
      "understand that my written authorization is required in order for the result of this testing to",
      "be provided to either party.",
    ],
  },
  {
    instrument: "mvr",
    page: 19,
    heading: "AUTHORIZATION FOR DRIVING RECORD CHECK",
    /**
     * ⚠ The page prints this heading twice and the text once, with two driver lines under it — read
     * as two forms merged by accident (`packetPlacements.ts`). The text is transcribed ONCE: it is one
     * release, and an instrument that said it twice would be a different document from either half.
     *
     * ⚠ The body/intent split falls INSIDE a workbook cell (`...Regulations. I hereby release...`),
     * at the sentence boundary. Nothing is added or removed; the test compares lines as substrings of
     * the workbook's rows for exactly this case. The first sentence is what is authorised; the second
     * is what the signer affirms by signing, which is the order the paper reads in.
     *
     * ⚠ The page's identity block (driver name, address, CDL number, state, expiry) is not part of
     * the release's text and is not transcribed. The permissions are signed before the application
     * form, so none of it is known yet — Q-MVR2.
     */
    paragraphs: [[
      "By signing below I  authorize you to release the information requested to SILVICOM, INC as directed",
      " by the Federal Motor Carrier Safety Administration Regulations.",
    ]],
    intent: [
      "I hereby release you from any",
      "liability which might be the result of providing this",
    ],
  },
];

/**
 * One page's corrections applied to one string — the same `PACKET_SPELLING` entries, in the same
 * order, that `packetSpellingPatch.ts` applies to the printed page (D-PKT20). Phrases are listed
 * before the words they contain, so an entry is never half-consumed by a shorter one.
 */
export function repair(source: string, page: number): string {
  let out = source;
  for (const e of PACKET_SPELLING) if (e.page === page) out = out.split(e.wrong).join(e.right);
  return out;
}

/**
 * Join a paragraph's workbook lines into one.
 *
 * ⚠ **Whitespace only.** The workbook wraps mid-sentence at whatever column the cell ran out at and
 * pads with runs of spaces; collapsing those is the difference between a legal instrument and a
 * screenshot of a spreadsheet. No character other than a space is added, removed or moved, which is
 * what lets `packetWording.test.ts` compare the published text back against the source word for word.
 */
const joinLines = (lines: readonly string[]): string =>
  lines.map((l) => l.trim()).join(" ").replace(/\s+/g, " ").trim();

export interface PacketWording {
  title: string;
  body: string;
  intent: string;
  /** The carrier's page number — shown to the office so they can check it against the paper. */
  page: number;
}

/** The carrier's own wording for one instrument, repaired and composed, or null if the packet has none. */
export function packetWording(instrument: PublishableInstrument): PacketWording | null {
  const src = PACKET_INSTRUMENTS.find((i) => i.instrument === instrument);
  if (!src) return null;
  return {
    title: repair(joinLines([src.heading]), src.page),
    body: src.paragraphs.map((p) => repair(joinLines(p), src.page)).join("\n\n"),
    intent: repair(joinLines(src.intent), src.page),
    page: src.page,
  };
}

/** Every instrument the packet can answer for — what the office is offered a draft of. */
export const PACKET_WORDING_INSTRUMENTS: readonly PublishableInstrument[] =
  PACKET_INSTRUMENTS.map((i) => i.instrument);
