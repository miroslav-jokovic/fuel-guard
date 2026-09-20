import { addressCells, blank, date, fullName } from "./packetDraw.js";
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
];

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
  for (const [id, caption] of PRINTED_NAME_LINES) push(into, id, name, caption);

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
