import { addressCells, blank, date, fullName } from "./packetDraw.js";
import { applyingAsOf, packetPageWithdrawn, signsAsOwnerOperator, type ApplyingAs } from "@silvicom/shared";
import { placeValue, type PacketFieldInput, type PlacedFieldValue } from "./packetGrid.js";
import {
  SINGLE_LICENCE_BLOCK_FIELDS,
  SINGLE_LICENCE_BLOCK_PAGES,
  signingLineFor,
} from "./packetSigningGeometry.js";

/**
 * What the driver writes about themselves on the pages they sign (AUD-17).
 *
 * ── WHAT THIS IS, AND WHAT `packetFieldValues.ts` NEXT DOOR IS ────────────────────────────────
 * That module answers the packet's QUESTIONS — the date of birth on page 1, the accidents on page 2,
 * the employment log on page 12. This one answers the other thing the carrier's paper asks for:
 * *write down who you are, again, next to where you sign*. Pages 18 and 19 ask a driver who gave
 * their name, address and licence on page 1 to give all three again; pages 3, 4, 10, 26, 28 and 31
 * ask for the name in block capitals; pages 22, 27 and 28 ask for the date.
 *
 * ⚠ **The owner's report, 2026-09-19: *"not all places are prefilled with applicant data."*** The
 * blanks he was seeing were not a bug in the filling — every measured line WAS filled. They were
 * lines nobody had measured, so the renderer had no way to know they existed. This module and
 * `packetSigningGeometry.ts` are the two halves of that: the measurements, and what goes on them.
 *
 * ── EVERY VALUE GOES THROUGH `blank()` ────────────────────────────────────────────────────────
 * `packetFieldValues.ts`'s rule, for its reason: this reads STORED payloads.
 * `driver_applications.payload` is historical jsonb, a row filed before a field existed has none of
 * it, and a derivative that throws on an old payload is a qualification file that cannot be produced.
 */

/** Resolve against the SIGNING table, which is the only one this module fills. */
const push = (into: PlacedFieldValue[], id: string, text: string, label?: string): void =>
  placeValue(into, signingLineFor(id), text, label);

/**
 * Every line on which the carrier asks for the signer's name in letters, with their caption.
 *
 * ⚠ **A list rather than a per-page call, because they all take the same string and that is the
 * point.** Before AUD-17 the packet could print two spellings of one person — `p15.name` drew the
 * payload's `Marija Ana Varmeda` while page 22's `Driver name Print` drew the adopted signature's
 * `Marija Varmeda`. Naming them together is what makes a third one impossible to add differently.
 *
 * ⚠ **Page 22's line is NOT here** — it sits beside its mark and is filled by
 * `packetFieldValues.ts`'s `markSides`, from the same `fullName` since AUD-18. Two places fill a
 * printed name; one function decides what it says.
 */
const PRINTED_NAME_LINES: ReadonlyArray<readonly [id: string, caption: string]> = [
  ["p03.printed_name", "Printed name"],
  ["p04.printed_name", "Print name"],
  ["p10.printed_name", "Print name"],
  ["p26.name", "Driver's/ Owner's Name:"],
  ["p28.driver_owner_name", "Driver/Owner Name:"],
  ["p31.driver_name", "Driver name:"],
  ["p31.owner_operator_name", "Owner Operator Name:"],
  /**
   * ⚠ **The caption is the carrier's sentence with its own blank left in it** (AUD-7). Q-PKT10 says
   * the continuation sheet must name a cut answer in the carrier's words, and the carrier's words
   * here are a sentence rather than a label — there is no `Name:` to quote. Quoting the sentence
   * around the blank is the nearest true thing; inventing `Owner-operator name` would put a caption
   * on the sheet that appears nowhere on the paper it continues.
   */
  ["p31.aka_op", "I ______ aka (OP)"],
];

/**
 * ⚠ **Page 31's owner-operator half, gated TOGETHER on one predicate (Q-HM14, ruled (b)).**
 *
 * `Owner Operator Name:`, the `I ____ aka (OP)` blank, and the `p31b` line under them ("as the
 * owner-operator") are one act in three places. AUD-17 and AUD-7 printed the applicant's name in the
 * first two because the ceremony already made them sign the third; since Q-HM14 a company driver is
 * not asked to sign it (memorandum Q15), so neither name may print for them either — a name above a
 * line nobody signed asserts the half of the act that did not happen (page 24's lesson, D-PKT10).
 * `signsAsOwnerOperator` is the one predicate: `driverPlacements` asks it for the line, this asks it
 * for the two names. A null answer (filed before the question, or left blank) is the paper as
 * printed, which is what every packet did before this.
 *
 * `Driver name:` is NOT in it — page 31 is the owner-operator AND leased-driver agreement, and a
 * company driver still signs `p31a` as the driver. `Witness Name:` stays out of it in every case:
 * `p31w` is a third person.
 */
const OWNER_OPERATOR_NAME_LINES: ReadonlySet<string> = new Set(["p31.owner_operator_name", "p31.aka_op"]);

/**
 * Page 22's `This test is required for:` answer, derived from `applying_as` (Q-HM14).
 *
 * ⚠ **Only the owner-operator's rule is ours to fill.** The company driver's reason,
 * `Pre-Employment Qualification:`, is already answered `yes` on the carrier's own paper
 * (`packetSigningGeometry.ts`'s header) — drawing a second `yes` over it would print the word twice.
 * ⚠ And nothing for a null answer: choosing a reason for somebody who never said which they are is
 * the inference Q-HM14 was ruled to remove.
 */
function testReason(applyingAs: ApplyingAs | null, into: PlacedFieldValue[]): void {
  if (applyingAs === "owner_operator") push(into, "p22.reason.contracting", "yes");
}

/**
 * The dates that stand ALONE on a signing page rather than beside the mark.
 *
 * ⚠ **Each one takes its own stop's `signed_at`, and a stop with no mark gets NO date** — the same
 * rule `markSides` states, for the same reason. A half-signed packet is a real state (0339), and a
 * date on a page whose signature has not been made yet is the document asserting something that has
 * not happened. ⚠ Deliberately NOT `certifiedAt`: certifying the application and signing page 28's
 * drug-and-alcohol policy are different acts on, usually, different days.
 *
 * ⚠ **`p22`, `p27` and `p28` only.** Their `Date` rules are stacked above or below the signature
 * rather than beside it, so `PACKET_MARK_SIDE_LINES`'s "same band as its own mark" assertion rules
 * them out by construction — which is exactly why they were never measured.
 */
const STANDALONE_DATE_LINES: ReadonlyArray<readonly [id: string, placementId: string]> = [
  ["p22.date", "p22"],
  ["p27.date", "p27"],
  ["p28.date", "p28"],
];

/**
 * The eight values pages 18 and 19 both ask for, in the block's own order.
 *
 * ⚠ **The CURRENT address, which is `addresses[0]`** — page 1's own residency grid reads it the same
 * way, and the carrier's caption here is `Address:` with no period attached. A driver's previous
 * three years belong on page 1, not on a licence certificate.
 *
 * ⚠ **`cdl` is the number ALONE**, unlike page 1's `p01.cdl`, which appends the state in brackets
 * because page 1 has no separate `State:` rule for the licence. This block does, at x360.5, so
 * writing `PA334554 (PA)` here would print the state twice on one row.
 */
function singleLicenceBlockValues(input: PacketFieldInput): Record<string, string> {
  const a = input.application;
  const [current] = a.addresses ?? [];
  const [street, city, state, zip] = addressCells(current ?? {});
  return {
    driver_name: fullName(a),
    address: street ?? "",
    city: city ?? "",
    state: state ?? "",
    zip: zip ?? "",
    cdl: blank(a.cdl_number),
    cdl_state: blank(a.cdl_state),
    cdl_expires: date(a.cdl_expires_at),
  };
}

/**
 * §40.25(j)'s two-year question, as an X in one of the two boxes the carrier drew on page 26.
 *
 * ⚠ **An absent answer ticks NEITHER box, and that is the whole of the care here.** The field
 * arrived with P8; a payload filed before it has no answer at all, and `driver_applications` is
 * append-only so it can never gain one. Ticking `NO` for a missing value would answer a mandatory
 * federal question on the applicant's behalf, in a document they have signed. A blank pair of boxes
 * is a question somebody has to come back to; a wrong tick is a false statement.
 *
 * ⚠ This is why it is `typeof … === "boolean"` and not `a.prior_failed_pre_employment_test ? … : …`,
 * which would send every old payload to `NO`.
 */
function priorTestAnswer(input: PacketFieldInput, into: PlacedFieldValue[]): void {
  const answered = input.application.prior_failed_pre_employment_test;
  if (typeof answered !== "boolean") return;
  push(into, answered ? "p26.prior_test.yes" : "p26.prior_test.no", "X");
}

export function packetSigningFill(input: PacketFieldInput, into: PlacedFieldValue[]): void {
  const name = fullName(input.application);
  const applyingAs = applyingAsOf(input.application);
  for (const [id, caption] of PRINTED_NAME_LINES) {
    // ⚠ L-1: no name in the block of a page withdrawn from signing — a name printed beside a line
    // nobody signed asserts the half of the act that did not happen (page 24's lesson, D-PKT10).
    const line = signingLineFor(id);
    if (line && packetPageWithdrawn(line.page)) continue;
    if (OWNER_OPERATOR_NAME_LINES.has(id) && !signsAsOwnerOperator(applyingAs)) continue;
    push(into, id, name, caption);
  }
  testReason(applyingAs, into);

  for (const [id, placementId] of STANDALONE_DATE_LINES) {
    const at = input.markedAt[placementId];
    if (at) push(into, id, date(at));
  }

  const block = singleLicenceBlockValues(input);
  for (const page of SINGLE_LICENCE_BLOCK_PAGES) {
    for (const field of SINGLE_LICENCE_BLOCK_FIELDS) push(into, `p${page}.${field}`, block[field] ?? "");
  }

  priorTestAnswer(input, into);
}
