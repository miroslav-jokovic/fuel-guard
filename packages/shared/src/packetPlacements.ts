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
  /**
   * What a recorded mark names, and the only field here that is ours rather than the carrier's.
   *
   * ⚠ **Nothing else on a placement identifies it.** Page 19's two driver lines are identical in
   * every other field — same page, same party, same mark, same anchor, same sentence — because the
   * carrier's page really does carry its heading and its signature line twice. Page 11's two differ
   * only in `what`, and page 31's likewise. A stored signature that said "page 19, driver" would not
   * say which of the two the driver was standing on, and the ceremony's own queue could not tell
   * which stop it had already collected.
   *
   * ⚠ **Written out rather than derived from the array's order, and that is deliberate.** An index
   * is the obvious id and it is the wrong one: `PACKET_PLACEMENTS` has already gained an entry in
   * the middle once (p17, D-PKT12, 2026-09-14) and will again if counsel rules on page 19's
   * duplicate. Derived ids would have silently re-pointed every signature filed before that merge at
   * a different line of the carrier's paper. These do not move, and a new placement takes a new
   * letter rather than shifting its neighbours.
   *
   * `p{page, zero-padded}` plus a letter when a page carries more than one of the same party's
   * marks, and `c`/`w` for the carrier's and the witness's. Zero-padded so the ids sort the way the
   * packet reads: `p03` before `p10`, which `p3` would not.
   *
   * ⚠ **The id is a convenience for the queue, never the record of what was signed.** A filed mark
   * stores this page, anchor and sentence verbatim beside it, for the reason 0215 stores
   * `disclosure_text`: §390.32(d) asks that a filed electronic record stay reproducible, and this
   * constant is edited whenever the carrier's paper is re-measured.
   */
  id: string;
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
  { id: "p03", page: 3, party: "driver", mark: "signature", anchor: "Date | Signature",
    what: "Orientation and the drug test it includes" },
  { id: "p04", page: 4, party: "driver", mark: "signature", anchor: "Applicant's Signature | Date",
    what: "Permission to obtain background reports" },
  { id: "p05", page: 5, party: "driver", mark: "initials", anchor: "Initials",
    what: "The minimum qualifications for the job" },
  { id: "p06", page: 6, party: "driver", mark: "initials", anchor: "Initials",
    what: "The documents required, and the criminal-history rules" },
  { id: "p09", page: 9, party: "driver", mark: "initials", anchor: "Initials",
    what: "Company rules and regulations, part three" },
  { id: "p10", page: 10, party: "driver", mark: "signature", anchor: "Signature | Date",
    what: "Company rules and regulations, part four" },
  // ⚠ Two on one page, and they say different things. The first releases previous employers to
  // answer; the second certifies that the application itself is true. The packet gives each its own
  // line and its own sentence, so the ceremony gives each its own stop.
  { id: "p11a", page: 11, party: "driver", mark: "signature", anchor: "Date | Applicant signature",
    what: "Permission to ask previous employers about you" },
  { id: "p11b", page: 11, party: "driver", mark: "signature", anchor: "Date | Applicant signature",
    what: "That everything on this application is true" },
  { id: "p13", page: 13, party: "driver", mark: "signature", anchor: "Signature of applicant | Date",
    what: "That your answers are true, and this stays open for 45 days" },
  { id: "p15", page: 15, party: "driver", mark: "signature", anchor: "Signature of applicant | Date | Sent to",
    what: "Release of your past employment and testing history" },
  // ⚠ Page 17 is a SPLIT page (D-PKT12): the top half is the applicant's and the bottom half —
  // `INTERVIEW NOTES`, `APPLICATION RESULTS`, `Contracted or Rejected?`, `Termination date` — is the
  // carrier's, filled in after a decision by somebody else. Only the top half is reproduced, and this
  // is its mark. The whole page was excluded until 2026-09-14 on a reading of the bottom half alone.
  { id: "p17", page: 17, party: "driver", mark: "signature", anchor: "Signature of applicant | Date",
    what: "That this application is true, and that we may check your history" },
  { id: "p18", page: 18, party: "driver", mark: "signature", anchor: "Driver signature: | Date:",
    what: "That the licence you gave us is the only one you hold" },
  { id: "p18c", page: 18, party: "carrier", mark: "signature", anchor: "Silvicom Inc Representative:",
    what: "Countersigned by the carrier" },
  // ⚠ Page 19 carries its heading twice and two identical driver signature lines. It reads as two
  // forms merged by accident, and until counsel says which one survives, both are placements: a
  // renderer that dropped one would produce a page the carrier's paper does not have.
  { id: "p19a", page: 19, party: "driver", mark: "signature", anchor: "Driver signature: | Date:",
    what: "Permission to check your driving record" },
  { id: "p19ac", page: 19, party: "carrier", mark: "signature", anchor: "Silvicom Inc Representative: | Date:",
    what: "Countersigned by the carrier" },
  { id: "p19b", page: 19, party: "driver", mark: "signature", anchor: "Driver signature: | Date:",
    what: "Permission to check your driving record" },
  { id: "p19bc", page: 19, party: "carrier", mark: "signature", anchor: "Silvicom Inc Representative:",
    what: "Countersigned by the carrier" },
  // ⚠ FCRA §604(b)(2). This one can never share a screen with anything else, whatever the queue
  // does around it — `SigningCeremony`'s one-instrument-per-screen rule is what implements that.
  { id: "p20", page: 20, party: "driver", mark: "signature", anchor: "Driver signature: | Date:",
    what: "Consumer reports for employment purposes" },
  // ⚠ `signatrure`. Reproduced exactly, because the anchor's job is to be findable in the workbook.
  { id: "p22", page: 22, party: "driver", mark: "signature", anchor: "Driver name Print | Driver signatrure",
    what: "Agreement to give a urine sample" },
  { id: "p22w", page: 22, party: "witness", mark: "signature", anchor: "Witness by",
    what: "Witnessed" },
  { id: "p22c", page: 22, party: "carrier", mark: "signature", anchor: "Company reprsentative's signature | Date",
    what: "Countersigned by the carrier" },
  { id: "p25", page: 25, party: "driver", mark: "signature", anchor: "Driver/Owner Signature",
    what: "Receipt of the driver handbooks" },
  { id: "p26", page: 26, party: "driver", mark: "signature", anchor: "Driver/Owner Signature",
    what: "Your answer about any earlier failed or refused test" },
  { id: "p27", page: 27, party: "driver", mark: "signature", anchor: "Signature",
    what: "Who may ride with you, and how off-duty time is logged" },
  { id: "p28", page: 28, party: "driver", mark: "signature", anchor: "Signature",
    what: "The alcohol and drug abuse policy" },
  // ⚠ Page 31 takes THREE marks and they are three different people: the driver, the owner-operator
  // and a witness. They are frequently the same person for the first two and the packet does not
  // assume it, so neither does this. The witness is neither the applicant nor the carrier, which is
  // why `party` has three values rather than two.
  { id: "p31a", page: 31, party: "driver", mark: "signature", anchor: "Signature | Date",
    what: "The owner-operator and leased-driver agreement, as the driver" },
  { id: "p31b", page: 31, party: "driver", mark: "signature", anchor: "Signature | Date",
    what: "The owner-operator and leased-driver agreement, as the owner-operator" },
  { id: "p31w", page: 31, party: "witness", mark: "signature", anchor: "Signature | Date",
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

/**
 * How many marks the ceremony has to collect before the packet is signed through.
 *
 * ⚠ **Derived, and deliberately not a column, a constant or a stamp.** The obvious alternative was a
 * `packet_signing_completed_at` on `application_invitations`, matching `releases_completed_at` — and
 * it would be a second place the number 22 lives, going stale the next time counsel rules on page
 * 19's duplicate. "Complete" is a count against this array, computed everywhere it is asked for,
 * which is the shape `record_driver_release`'s `p_expected_count` already established: the
 * vocabulary lives in TypeScript and the migration applies what it produced.
 */
export const packetDriverMarkCount = (): number => driverPlacements().length;

/** One stop, by the id a recorded mark names. Null for an id no longer in the inventory. */
export const packetPlacementById = (id: string): PacketPlacement | null =>
  PACKET_PLACEMENTS.find((p) => p.id === id) ?? null;

/**
 * The ids the ceremony may collect — the driver's stops and nothing else.
 *
 * ⚠ The set exists so the server can refuse `p18c` and `p22w` rather than trusting the client to
 * offer only the driver's stops. A ceremony bug that walked an applicant onto the carrier's
 * countersignature or a witness's line would put their name where somebody else's belongs, on a
 * page that is evidence — and the request that did it would look exactly like every other one.
 */
export const driverPlacementIds = (): string[] => driverPlacements().map((p) => p.id);
