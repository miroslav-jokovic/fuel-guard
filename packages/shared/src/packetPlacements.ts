/**
 * Every place the carrier's packet asks for a mark — and, for each, WHOSE mark it is (Q-PKT6).
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────────
 * `APPLICATION-PACKET-PLAN.md` §2.3 recorded "21 signature or initial points across 17 pages" and
 * D-PKT6 committed to walking the driver to all of them with a Next button. The count came from
 * looking for signature lines; it never asked whose they were. Four kinds of line were mixed
 * together, and a queue built from the raw number would have walked a driver to a place where the
 * COMPANY signs — or a WITNESS does.
 *
 * ⚠ **And the inventory cannot be re-derived by searching for "signature".** The packet spells it
 * `signatrure` on pages 22, 23 and 24, writes `Initials` on three pages, and writes
 * `Driver/Owner Signature` on two more. A grep for the word misses six placements on five pages.
 * Every entry below carries the workbook line it sits on, and `packetPlacements.test.ts` re-reads
 * `APPLICATION.xlsx` and fails if the line is not there — so this is a measurement, not a memory.
 *
 * ── WHAT THE MEASUREMENT SAYS ─────────────────────────────────────────────────────────────────
 * **22 marks are the driver's, across 19 pages. Six are not: four the carrier's and two a
 * witness's.** The plan's 21 was numerically right and structurally wrong — it was reached before
 * page 26 was known to take a signature at all (§3.7), and it counted company lines to get there.
 * Two errors of the same size in opposite directions is the most expensive kind of correct number,
 * because nothing about it looks wrong.
 *
 * ⚠ **The 22nd arrived on 2026-09-14 (D-PKT12), and it was missing for the page-24 reason.** Page 17
 * was classified in the plan's §2.4 as "interview / disposition record — carrier-filled, after the
 * application, by somebody else" and excluded whole. That describes its BOTTOM half. Its top half is
 * the applicant's certification — *"I certify that this application has been completed by me, and
 * all of the entries provided are true"* — plus an authorization to inquire into employment,
 * financial, personal and medical history, over `Signature of applicant | Date`. Excluding the page
 * dropped the most load-bearing signature in the packet.
 *
 * ⚠ **This is the second page classified by one of its halves**, after p24 (D-PKT10). The plan wrote
 * its own warning after the first one — *"no test in this repository can check a classification"* —
 * and p24 was only caught because it had shipped. This one never shipped, so nothing flagged it; it
 * was found by measuring the rendered PDF's ruled lines and comparing that inventory against this
 * constant. **That comparison is the check the plan said did not exist.**
 *
 * ── WHAT IT DOES NOT DECIDE ───────────────────────────────────────────────────────────────────
 * Nothing here adopts any wording. The pages these marks sit under are instruments and go to counsel
 * as one review (P1); this is the geometry, which is settled and which P5 needs before it can build
 * a queue. The two can be finished in either order.
 */

export const PACKET_MARK_PARTIES = ["driver", "carrier", "witness"] as const;
export type PacketMarkParty = (typeof PACKET_MARK_PARTIES)[number];

export const PACKET_MARK_KINDS = ["signature", "initials"] as const;
export type PacketMarkKind = (typeof PACKET_MARK_KINDS)[number];

export interface PacketPlacement {
  /** The carrier's own page number, from the footer — the workbook stores no page breaks. */
  page: number;
  party: PacketMarkParty;
  mark: PacketMarkKind;
  /**
   * The workbook line this placement sits on, verbatim. The anchor a test re-reads, and the reason
   * the count below is checkable by somebody holding the paper.
   */
  anchor: string;
  /**
   * What the signer is affirming, in one sentence — the ceremony's step header.
   *
   * ⚠ Names no regulation (D-UI9). A driver on a phone being walked through twenty-one stops needs
   * to know what each one is; a paragraph number tells them nothing they can act on.
   */
  what: string;
}

/**
 * ⚠ **In the packet's own page order, which is the order the ceremony must walk.** A driver
 * reviewing a document they are signing follows the paper; reordering by convenience would mean the
 * PDF and the ceremony disagree about what came before what, on a document whose whole purpose is to
 * be reproducible.
 */
export const PACKET_PLACEMENTS: readonly PacketPlacement[] = [
  { page: 3, party: "driver", mark: "signature", anchor: "Date | Signature",
    what: "Orientation and the drug test it includes" },
  { page: 4, party: "driver", mark: "signature", anchor: "Applicant's Signature | Date",
    what: "Permission to obtain background reports" },
  { page: 5, party: "driver", mark: "initials", anchor: "Initials",
    what: "The minimum qualifications for the job" },
  { page: 6, party: "driver", mark: "initials", anchor: "Initials",
    what: "The documents required, and the criminal-history rules" },
  { page: 9, party: "driver", mark: "initials", anchor: "Initials",
    what: "Company rules and regulations, part three" },
  { page: 10, party: "driver", mark: "signature", anchor: "Signature | Date",
    what: "Company rules and regulations, part four" },
  // ⚠ Two on one page, and they say different things. The first releases previous employers to
  // answer; the second certifies that the application itself is true. The packet gives each its own
  // line and its own sentence, so the ceremony gives each its own stop.
  { page: 11, party: "driver", mark: "signature", anchor: "Date | Applicant signature",
    what: "Permission to ask previous employers about you" },
  { page: 11, party: "driver", mark: "signature", anchor: "Date | Applicant signature",
    what: "That everything on this application is true" },
  { page: 13, party: "driver", mark: "signature", anchor: "Signature of applicant | Date",
    what: "That your answers are true, and this stays open for 45 days" },
  { page: 15, party: "driver", mark: "signature", anchor: "Signature of applicant | Date | Sent to",
    what: "Release of your past employment and testing history" },
  // ⚠ Page 17 is a SPLIT page (D-PKT12): the top half is the applicant's and the bottom half —
  // `INTERVIEW NOTES`, `APPLICATION RESULTS`, `Contracted or Rejected?`, `Termination date` — is the
  // carrier's, filled in after a decision by somebody else. Only the top half is reproduced, and this
  // is its mark. The whole page was excluded until 2026-09-14 on a reading of the bottom half alone.
  { page: 17, party: "driver", mark: "signature", anchor: "Signature of applicant | Date",
    what: "That this application is true, and that we may check your history" },
  { page: 18, party: "driver", mark: "signature", anchor: "Driver signature: | Date:",
    what: "That the licence you gave us is the only one you hold" },
  { page: 18, party: "carrier", mark: "signature", anchor: "Silvicom Inc Representative:",
    what: "Countersigned by the carrier" },
  // ⚠ Page 19 carries its heading twice and two identical driver signature lines. It reads as two
  // forms merged by accident, and until counsel says which one survives, both are placements: a
  // renderer that dropped one would produce a page the carrier's paper does not have.
  { page: 19, party: "driver", mark: "signature", anchor: "Driver signature: | Date:",
    what: "Permission to check your driving record" },
  { page: 19, party: "carrier", mark: "signature", anchor: "Silvicom Inc Representative: | Date:",
    what: "Countersigned by the carrier" },
  { page: 19, party: "driver", mark: "signature", anchor: "Driver signature: | Date:",
    what: "Permission to check your driving record" },
  { page: 19, party: "carrier", mark: "signature", anchor: "Silvicom Inc Representative:",
    what: "Countersigned by the carrier" },
  // ⚠ FCRA §604(b)(2). This one can never share a screen with anything else, whatever the queue
  // does around it — `SigningCeremony`'s one-instrument-per-screen rule is what implements that.
  { page: 20, party: "driver", mark: "signature", anchor: "Driver signature: | Date:",
    what: "Consumer reports for employment purposes" },
  // ⚠ `signatrure`. Reproduced exactly, because the anchor's job is to be findable in the workbook.
  { page: 22, party: "driver", mark: "signature", anchor: "Driver name Print | Driver signatrure",
    what: "Agreement to give a urine sample" },
  { page: 22, party: "witness", mark: "signature", anchor: "Witness by",
    what: "Witnessed" },
  { page: 22, party: "carrier", mark: "signature", anchor: "Company reprsentative's signature | Date",
    what: "Countersigned by the carrier" },
  { page: 25, party: "driver", mark: "signature", anchor: "Driver/Owner Signature",
    what: "Receipt of the driver handbooks" },
  { page: 26, party: "driver", mark: "signature", anchor: "Driver/Owner Signature",
    what: "Your answer about any earlier failed or refused test" },
  { page: 27, party: "driver", mark: "signature", anchor: "Signature",
    what: "Who may ride with you, and how off-duty time is logged" },
  { page: 28, party: "driver", mark: "signature", anchor: "Signature",
    what: "The alcohol and drug abuse policy" },
  // ⚠ Page 31 takes THREE marks and they are three different people: the driver, the owner-operator
  // and a witness. They are frequently the same person for the first two and the packet does not
  // assume it, so neither does this. The witness is neither the applicant nor the carrier, which is
  // why `party` has three values rather than two.
  { page: 31, party: "driver", mark: "signature", anchor: "Signature | Date",
    what: "The owner-operator and leased-driver agreement, as the driver" },
  { page: 31, party: "driver", mark: "signature", anchor: "Signature | Date",
    what: "The owner-operator and leased-driver agreement, as the owner-operator" },
  { page: 31, party: "witness", mark: "signature", anchor: "Signature | Date",
    what: "Witnessed" },
];

/** The queue P5 builds. Everything else on the paper belongs to somebody who is not the applicant. */
export const driverPlacements = (): PacketPlacement[] =>
  PACKET_PLACEMENTS.filter((p) => p.party === "driver");

/**
 * The two adopted marks (D-PKT6): a signature typed once, and a set of initials typed once.
 *
 * ⚠ Initials are a SECOND adopted mark and not an abbreviation of the first. The packet treats them
 * as a distinct thing — three pages take initials and nothing else — and a ceremony that derived
 * them from the typed name would be inventing a mark the signer never made.
 */
export const adoptedMarkKinds = (): PacketMarkKind[] => [
  ...new Set(driverPlacements().map((p) => p.mark)),
];
