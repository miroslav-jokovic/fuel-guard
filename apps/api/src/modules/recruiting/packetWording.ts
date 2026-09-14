import type { PublishableInstrument } from "@silvicom/shared";

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
 * A repair whose two halves differ only in the spelling of a word.
 *
 * The rule `packetText.ts` set for the printed packet, applied here for the same reason and with
 * the same guard: **the word count may not change.** That is the one cheap check that catches a
 * dropped clause or an inserted qualifier hiding inside what claims to be a typo fix.
 */
export interface WordingRepair {
  /** Exactly as the workbook has it. Never published. */
  packet: string;
  /** What is published instead. */
  corrected: string;
  page: number;
}

/**
 * ⚠ Spelling only. Not one clause, obligation or citation is reworded.
 *
 * The packet is an OCR-grade document — `emplyer` appears eight times, `infromation` twice — and
 * D-PKT9 (owner, 2026-08-23) already ruled that we print correct English and record every repair so
 * the answer to "what did you change on our form" is a constant somebody can read.
 *
 * ⚠ **Order matters, and the phrases come first.** Each entry is matched against the workbook's own
 * text, so an entry spanning several words has to run before the single-word entries that would
 * otherwise consume part of it — `infromation form previous emplyer(s)` stops matching the moment
 * `infromation` has already been repaired on its own. The test asserts every key against the RAW
 * workbook, which is what makes an ordering mistake a failure rather than a silent miss.
 */
export const WORDING_SPELLING_REPAIRS: readonly WordingRepair[] = [
  // ── phrases, before the words they contain ──
  { page: 14, packet: "infromation form previous emplyer(s)", corrected: "information from previous employer(s)" },
  { page: 14, packet: "has not yer received", corrected: "has not yet received" },
  { page: 14, packet: "withing 30 days", corrected: "within 30 days" },
  // ── single words ──
  { page: 14, packet: "ahuthorize", corrected: "authorize" },
  { page: 14, packet: "emplyer/school", corrected: "employer/school" },
  { page: 14, packet: "emplyment", corrected: "employment" },
  { page: 14, packet: "adultered", corrected: "adulterated" },
  { page: 14, packet: "preivious", corrected: "previous" },
  { page: 14, packet: "certy", corrected: "certify" },
  { page: 14, packet: "prvious", corrected: "previous" },
  { page: 14, packet: "emloyers", corrected: "employers" },
  { page: 14, packet: "paragrafs", corrected: "paragraphs" },
  { page: 14, packet: "emplyers", corrected: "employers" },
  { page: 14, packet: "emplyer(s)", corrected: "employer(s)" },
  { page: 14, packet: "requlated", corrected: "regulated" },
  { page: 14, packet: "emplyed", corrected: "employed" },
  { page: 14, packet: "infromation", corrected: "information" },
  { page: 14, packet: "howerver", corrected: "however" },
  // A defined term the same sentence capitalises correctly nowhere else on the page.
  { page: 21, packet: "The medical Review Officer", corrected: "The Medical Review Officer" },
];

/**
 * Repairs that change the characters rather than the spelling — so each one is argued on its own.
 *
 * ⚠ These are the ones a reviewer must actually look at. A split word rejoined is harmless; a
 * statutory citation repaired is not, because the citation is part of the instrument. Every entry
 * carries the reason it is safe, and `WORDING-REVIEW-2026-09-13.md` lists them for counsel in the
 * same order.
 */
export interface TypographyRepair extends WordingRepair {
  /** Why this is a transcription defect and not a change of meaning. */
  why: string;
}

export const WORDING_TYPOGRAPHY_REPAIRS: readonly TypographyRepair[] = [
  {
    page: 19,
    packet: "applicants. T he purpose",
    corrected: "applicants. The purpose",
    why: "One word split by a stray space. No character added or removed but the space itself.",
  },
  {
    page: 19,
    packet: "(15 U.S.C. 1681-168lu)",
    corrected: "(15 U.S.C. 1681-1681u)",
    why:
      "A lower-case L standing where a 1 belongs, in the citation of the FCRA's own section range. "
      + "15 U.S.C. §§1681–1681u is the Act; 168lu is not a citation of anything. ⚠ This one alters a "
      + "legal citation and is listed first for counsel.",
  },
  {
    page: 14,
    packet: "paragrafs (d) and € of Section 391.23",
    corrected: "paragraphs (d) and (e) of Section 391.23",
    why:
      "A euro sign standing where `(e)` belongs — the same substitution appears on page 10 as "
      + "`391.23(d) and €`. §391.23 has paragraphs (d) and (e), and (e) is the one that carries the "
      + "due-process rights the next sentence goes on to enumerate.",
  },
  {
    page: 14,
    packet: "The applicanthas certain",
    corrected: "The applicant has certain",
    why:
      "Two words run together by a missing space. Nothing is added or removed but the space, and "
      + "`applicanthas` is not a word in any reading of the sentence.",
  },
];

/**
 * ⚠ **Corruption left exactly as the carrier has it, because the right word is a guess.**
 *
 * Recorded rather than silently skipped — the rule `packetText.ts` states and the reason it
 * outlives its own entries: a repair that guesses is a wording change, and a wording change to a
 * signed instrument is counsel's act. Each of these is a question for the review, not a fix.
 */
export const WORDING_LEFT_ALONE: readonly { page: number; text: string; question: string }[] = [
  {
    page: 14,
    text: "and with to review previous employer provided investigative information",
    question: "`with` almost certainly wants to be `wish`, but almost certainly is not certainly.",
  },
  {
    page: 14,
    text: "which may be done at any including when applying",
    question: "A word is missing after `at any` — `time`, on any sensible reading. We are not the ones to add it.",
  },
  {
    page: 14,
    text: "within 30 days SILVICOM INC making them available",
    question: "Reads as though `of` is missing after `days`.",
  },
  {
    page: 14,
    text: "to furnish SILVICOM INC they above requested information",
    question: "`they` where `the` is meant, most likely — but it is inside the §40.25 authorization.",
  },
  {
    page: 19,
    text: "may be used for employment /contract purposes",
    question:
      "A stray space before the slash. Repairing it would join two tokens into one and break the "
      + "word-count guard that makes every other repair on this page checkable.",
  },
  {
    page: 21,
    text: "regarding pre-employment. contracted drivers / owners",
    question: "A full stop where a comma belongs. Punctuation is left alone throughout — see `packetText.ts`.",
  },
  {
    page: 21,
    text: "I have been informed and understand. that should controlled substance testing produce a positive result. it will",
    question: "Two more sentence-ending periods mid-clause. Same rule.",
  },
];

/** One instrument, as the packet has it. Lines are workbook cells, trimmed and nothing else. */
export interface PacketInstrumentSource {
  instrument: PublishableInstrument;
  /** The carrier's own page number, from the footer — where a reviewer finds it on paper. */
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
 * ⚠ **Four, not six, and the gap is the whole finding.** `psp` and `clearinghouse` do not appear in
 * this packet in any form — no Pre-Employment Screening Program, no MCMIS, no §382.701, searched
 * across all 697 of the workbook's strings. The 7001(c) electronic-records consent is not there
 * either, and could not be: it exists because the driver signs on a phone, which a paper packet
 * never contemplated. See `WORDING-REVIEW-2026-09-13.md` §3 for what that leaves open.
 *
 * ⚠ **Page 18's `AUTHORIZATION FOR DRIVING RECORD CHECK` is transcribed nowhere below, and that is
 * not an oversight.** It is the MVR authorization, and this product has no MVR instrument to publish
 * it into — `AUTHORIZATION_PURPOSES` has no `mvr` member, no vendor was ever bought, and
 * `SCREENING_PREREQUISITES.mvr_order` rides on `fcra_disclosure` and is called by nothing. The
 * carrier's lawyers wrote an authorization we have nowhere to put; recorded here so the next reader
 * does not conclude it was missed.
 */
export const PACKET_INSTRUMENTS: readonly PacketInstrumentSource[] = [
  {
    instrument: "fcra_disclosure",
    page: 19,
    heading: "FAIR CREDIT REPORTING ACT DISCLOSURE",
    /**
     * ⚠ Page 19 ALONE, deliberately. Page 3's `Independent Contractor Notification & Release` is
     * also a consumer-report disclosure, and it is not merged in here: it combines the disclosure
     * with a general liability release and an ongoing procurement authorization, which is the exact
     * combination FCRA §604(b)(2) forbids by requiring a document that consists SOLELY of the
     * disclosure. Merging them would import that problem into the one instrument built to avoid it.
     * Page 3 is raised in the review instead.
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
    page: 14,
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
    page: 21,
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
];

/**
 * Apply both registers to one string.
 *
 * Order matters only in that the typography repairs carry more context than the spelling ones, so
 * they run first and cannot be half-consumed by a shorter match.
 */
export function repair(source: string): string {
  let out = source;
  for (const r of WORDING_TYPOGRAPHY_REPAIRS) out = out.split(r.packet).join(r.corrected);
  for (const r of WORDING_SPELLING_REPAIRS) out = out.split(r.packet).join(r.corrected);
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
    title: repair(joinLines([src.heading])),
    body: src.paragraphs.map((p) => repair(joinLines(p))).join("\n\n"),
    intent: repair(joinLines(src.intent)),
    page: src.page,
  };
}

/** Every instrument the packet can answer for — what the office is offered a draft of. */
export const PACKET_WORDING_INSTRUMENTS: readonly PublishableInstrument[] =
  PACKET_INSTRUMENTS.map((i) => i.instrument);
