import type { ApplyingAs } from "./questionnaireContract.js";

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
 * witness's.** ⚠ Since L-1 (2026-09-24) the ceremony collects **21**: page 4's line is still the
 * driver's on the paper and is withdrawn from signing (`PACKET_WITHDRAWALS`). The plan's 21 was numerically right and structurally wrong — it was reached before
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
  /**
   * The capacity the paper asks this line to be signed in, where it names one other than "the
   * applicant" (Q-HM14).
   *
   * ⚠ **A fact about the paper, not a decision** — which is why it is a field here and not a table
   * beside it like `PACKET_WITHDRAWALS`. Page 31's second line sits under `Owner Operator Name:` and
   * its `what` already says *"as the owner-operator"*. Whether a given applicant is asked to sign it
   * is decided in `driverPlacements`, from what they said they are applying as.
   */
  capacity?: "owner_operator";
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
  // forms merged by accident, and both stay placements: a renderer that dropped one would produce a
  // page the carrier's paper does not have. Since D-MVR1 (2026-09-25) neither is SIGNED here — the
  // release is a permission now — see `PACKET_WITHDRAWALS`.
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
  // Since D-PKT19 (2026-09-25) it is not walked at all: the disclosure is signed as its own
  // permission, and so are pages 15 and 22 — see `PACKET_WITHDRAWALS`.
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
  // why `party` has three values rather than two. ⚠ Since Q-HM14 a company driver is not asked to
  // sign p31b (memorandum Q15) — `capacity` names it, `driverPlacements` applies it.
  { id: "p31a", page: 31, party: "driver", mark: "signature", anchor: "Signature | Date",
    what: "The owner-operator and leased-driver agreement, as the driver" },
  { id: "p31b", page: 31, party: "driver", mark: "signature", anchor: "Signature | Date",
    what: "The owner-operator and leased-driver agreement, as the owner-operator",
    capacity: "owner_operator" },
  { id: "p31w", page: 31, party: "witness", mark: "signature", anchor: "Signature | Date",
    what: "Witnessed" },
];

/**
 * A driver's line the carrier has taken OUT of electronic signing, and why (L-1).
 *
 * ── WHY A SEPARATE TABLE AND NOT A DELETED ROW ────────────────────────────────────────────────
 * `PACKET_PLACEMENTS` is a measurement of the carrier's paper, and the paper has not changed: page 4
 * still carries `Applicant's Signature | Date`, and the template still prints it. Deleting the row
 * would make the inventory disagree with the page it measures, and `packetPlacements.test.ts`'s
 * re-read of the workbook exists to stop exactly that. What changed is a DECISION about the line,
 * so the decision gets its own table, keyed by the same id, and is reversible by deleting one entry
 * when counsel answers.
 *
 * ⚠ **Withdrawn is not "not the driver's".** `party` stays `"driver"` — it is the applicant's line on
 * the paper — and every consumer that asks "which stops does the ceremony walk?" goes through
 * `driverPlacements()`, which is where the withdrawal is applied, once. A consumer reading `party`
 * directly would put p04 back in the walk; the server's refusal (`recordPacketMark`) asks
 * `driverPlacementIds()` for that reason.
 *
 * ⚠ **A mark recorded before the withdrawal stays a row** (`application_packet_marks` is evidence and
 * append-only). It is no longer COUNTED (`countedPacketMarks`) and no longer PRINTED (the overlay
 * skips a withdrawn id and draws `notice` on the line instead) — so production's 2026-09-17 QA walk
 * neither completes a stop early nor files page 4 signed.
 */
export interface PacketWithdrawal {
  /** The decision, by its id in `COUNSEL-REVIEW-PACKAGE.md`. */
  ruling: string;
  /** YYYY-MM-DD, the day of the ruling. */
  since: string;
  /**
   * What the filed page says on the blank line, to whoever reads the paper.
   *
   * ⚠ Printed ON the carrier's page, because the packet has no certificate page of its own to carry
   * it and an unexplained blank signature line on a filed packet reads as a signature that failed to
   * record. It names no case and no statute: the reader is an auditor or the applicant, and "pending
   * legal review" is the fact.
   */
  notice: string;
}

export const PACKET_WITHDRAWALS: Readonly<Record<string, PacketWithdrawal>> = {
  // ⚠ L-1 (owner, 2026-09-24; memorandum Q1). Page 4 puts a consumer-report disclosure, an
  // all-capitals release of liability, consent to resale and an SSN field on one page. *Syed v.
  // M-I, LLC*, 853 F.3d 492 (9th Cir. 2017) holds a liability waiver inside the disclosure document a
  // WILLFUL §604(b)(2)(A)(i) violation. Page 20 already is the correctly-shaped disclosure, so a
  // page-4 signature adds exposure and no protection. Removed when counsel answers Q1.
  p04: {
    ruling: "L-1",
    since: "2026-09-24",
    notice: "Not signed electronically. Withdrawn from signing on 09/24/2026, pending legal review.",
  },
  // ⚠ D-MVR1 (owner, 2026-09-25; MVR-RELEASE-AND-TEMPLATES-PLAN.md). Page 19 is the carrier's
  // `AUTHORIZATION FOR DRIVING RECORD CHECK`, and it is now the sixth PERMISSION — signed on the link
  // before the application, where the MVR step can see it. Both of the page's driver lines go, because
  // the page is one release printed with two signature blocks, and signing either would be the same
  // release twice. The notice says where the signature went, not that it is missing.
  p19a: {
    ruling: "D-MVR1",
    since: "2026-09-25",
    notice: "Not signed here. Signed electronically as its own permission.",
  },
  p19b: {
    ruling: "D-MVR1",
    since: "2026-09-25",
    notice: "Not signed here. Signed electronically as its own permission.",
  },
  // ⚠ D-PKT19 (owner, 2026-09-25: *"we dont need duplicate pages"*). D-MVR1's reasoning, applied to
  // the three pages it already described: each is the carrier's text of a permission the driver has
  // signed on the link before the form (`PACKET_INSTRUMENTS`, `packetWording.ts`) — page 15 is
  // `previous_employer`, page 20 `fcra_disclosure`, page 22 `drug_alcohol`. Until this ruling every
  // applicant signed each release twice, in two slightly different texts (memorandum Q3), and page
  // 20's second signature was the weaker of the two: §604(b)(2) wants a document that consists solely
  // of the disclosure, which the permission is and a page inside a 31-page packet is not.
  // ⚠ Page 22's witness and carrier lines (`p22w`, `p22c`) were never walked and are not withdrawn —
  // they print blank as the carrier's own lines always have.
  p15: {
    ruling: "D-PKT19",
    since: "2026-09-25",
    notice: "Not signed here. Signed electronically as its own permission.",
  },
  p20: {
    ruling: "D-PKT19",
    since: "2026-09-25",
    notice: "Not signed here. Signed electronically as its own permission.",
  },
  p22: {
    ruling: "D-PKT19",
    since: "2026-09-25",
    notice: "Not signed here. Signed electronically as its own permission.",
  },
};

/** The withdrawal on this placement, or null while it is signed as normal. */
export const packetWithdrawal = (id: string): PacketWithdrawal | null => PACKET_WITHDRAWALS[id] ?? null;

/**
 * Does a page carry a driver's line, and is every one of them withdrawn?
 *
 * ⚠ The question the printed-name blanks ask. A name printed in block capitals beside a signature
 * line nobody signed asserts the half of the act that did not happen — page 24's lesson (D-PKT10):
 * "a name printed on one asserts an act nobody performed".
 */
export const packetPageWithdrawn = (page: number): boolean => {
  const lines = PACKET_PLACEMENTS.filter((p) => p.page === page && p.party === "driver");
  return lines.length > 0 && lines.every((p) => packetWithdrawal(p.id) !== null);
};

/**
 * Every line on the paper that is the driver's, INCLUDING the withdrawn ones.
 *
 * ⚠ The question geometry asks, and only geometry: the measured rules (`packetMarkGeometry.ts`,
 * the dates and printed names beside them) describe the carrier's paper, which still carries page
 * 4's line. Asking `driverPlacements()` there would make a measurement depend on a legal ruling.
 */
export const paperDriverPlacements = (): PacketPlacement[] =>
  PACKET_PLACEMENTS.filter((p) => p.party === "driver");

/**
 * Is this applicant asked to sign, and named, as the owner-operator? (Q-HM14)
 *
 * ⚠ **One predicate for the whole of page 31's owner-operator half**, because the ruling gates it
 * TOGETHER: the `p31b` line (`driverPlacements`), `Owner Operator Name:` and the `I ____ aka (OP)`
 * blank (`packetSigningFields.ts`). Three places asking three questions would let a company driver's
 * page carry a signature under a blank owner-operator name, or a name above a line nobody signed.
 *
 * ⚠ **Only an explicit `company_driver` says no.** Null — a payload filed before the question, or an
 * applicant who left it blank — is the paper as printed (`applyingAsOf`).
 */
export const signsAsOwnerOperator = (applyingAs: ApplyingAs | null): boolean =>
  applyingAs !== "company_driver";

/**
 * The queue P5 builds, for ONE applicant. Everything else on the paper belongs to somebody who is
 * not the applicant, has been withdrawn from signing (`PACKET_WITHDRAWALS`), or asks for a capacity
 * this applicant is not signing in (Q-HM14).
 *
 * ⚠ **`applyingAs` is required, and null is a value you pass, not a default you get.** Since Q-HM14
 * the walk is per applicant, and every caller — the served queue, the server's refusal, the count
 * the database stamps, the submit gate, the checklist, the board, the overlay — has to be asked the
 * same question with the same answer. A defaulted parameter is how one of them would quietly keep
 * asking the paper's question and disagree with the others about when a company driver is done.
 */
export const driverPlacements = (applyingAs: ApplyingAs | null): PacketPlacement[] =>
  paperDriverPlacements().filter(
    (p) =>
      packetWithdrawal(p.id) === null
      && (p.capacity !== "owner_operator" || signsAsOwnerOperator(applyingAs)),
  );

/**
 * The two adopted marks (D-PKT6): a signature typed once, and a set of initials typed once.
 *
 * ⚠ Initials are a SECOND adopted mark and not an abbreviation of the first. The packet treats them
 * as a distinct thing — three pages take initials and nothing else — and a ceremony that derived
 * them from the typed name would be inventing a mark the signer never made.
 *
 * ⚠ Asked of the PAPER's walk (`null`) on purpose: `p31b` is a signature, and a company driver's walk
 * still holds a dozen others, so both walks adopt the same two kinds.
 */
export const adoptedMarkKinds = (): PacketMarkKind[] => [
  ...new Set(driverPlacements(null).map((p) => p.mark)),
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
export const packetDriverMarkCount = (applyingAs: ApplyingAs | null): number =>
  driverPlacements(applyingAs).length;

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
export const driverPlacementIds = (applyingAs: ApplyingAs | null): string[] =>
  driverPlacements(applyingAs).map((p) => p.id);

/**
 * How many of the ceremony's CURRENT stops a link has marked, from the placement ids on its rows.
 *
 * ⚠ **Not the number of rows.** A mark made at a line since withdrawn (L-1: production's 2026-09-17
 * walk may hold a p04) is still a row, and counting it would let a link reach the total one real stop
 * short — the checklist would go green and the ceremony would announce itself finished while the
 * submit gate, which asks for every id, still refused. Distinct, because the database's unique index
 * makes duplicates impossible and a count that relied on that would be a count that trusted it.
 *
 * ⚠ Per applicant since Q-HM14, for the same reason: a `p31b` made before somebody changed their
 * answer to company driver is a row, and not one of their stops.
 */
export const countedPacketMarks = (
  placementIds: readonly string[],
  applyingAs: ApplyingAs | null,
): number => {
  const current = new Set(driverPlacementIds(applyingAs));
  return new Set(placementIds.filter((id) => current.has(id))).size;
};
