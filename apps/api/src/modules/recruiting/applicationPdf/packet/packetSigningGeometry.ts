import type { PacketFieldLine } from "./packetFieldGeometry.js";

/**
 * What the SIGNING pages ask the signer to write down about themselves (AUD-17, D-PKT1).
 *
 * ── WHY THIS IS NOT IN `packetFieldGeometry.ts`, WHICH IS THE OBVIOUS PLACE ───────────────────
 * That module answers *"where does an ANSWER to one of the packet's questions go"* — page 1's date
 * of birth, page 2's accident grid, page 16's references. This one answers a different question
 * about the same paper: *"where does the person signing restate who they are"*. Pages 18 and 19 ask
 * a driver who has already given their name, address and licence on page 1 to write all three out
 * again beside their mark; pages 3, 4, 10, 26, 28 and 31 ask for the name in block capitals; pages
 * 22, 27 and 28 ask for the date they signed. None of that is an answer to a question, and the split
 * is the same one `packetMarkGeometry.ts` already makes for the marks themselves.
 *
 * ⚠ **The two tables must not overlap, and `packetSigningGeometry.test.ts` asserts it by id** —
 * a coordinate written into both is a value drawn twice, once from each.
 *
 * ── ⚠ HAND-VERIFIED, THE SAME WAY AND ON THE SAME AFTERNOON ──────────────────────────────────
 * Every entry below was established by drawing a magenta sample value and a pair of cyan span ticks
 * onto the carrier's own page, rasterising with `pdftoppm -r 110` (`-r 150` for the crops), and
 * LOOKING at it — twenty-eight of them. `APPLICATION-PACKET-PLAN.md` §8 has the write-up of the
 * heuristic that was tried first and does not work. Nothing here was computed from a layout rule.
 *
 * ⚠ **The candidate list this started from was wrong in BOTH directions, which is why §8's loop is
 * not optional.** It came from proximity matching, and proximity lies both ways: page 19's
 * `Company name:` already has `Silvicom Inc` printed beside it by the carrier and is not a blank at
 * all, while pages 18 and 19 each carry a whole eight-line identity block of which the list named
 * one line. What a rendered page settles, a list of nearby captions cannot.
 *
 * ── ⚠ WHAT STAYS BLANK, AND NONE OF IT IS AN OVERSIGHT ───────────────────────────────────────
 * · **Pages 14, 21, 23 and 24** carry blanks and take NO driver mark. D-PKT1: they are not the
 *   applicant's document — 14 is the previous-employer request WE send, 23 the annual violation
 *   review, 24 the `DRIVER SAFETY TRAINING` page that left the packet on 2026-08-23 (Q-PKT5)
 *   because it affirms a training that has not happened. A name printed on one of them asserts an
 *   act nobody performed.
 * · **The Social Security number** — page 1, page 12's `SS #`, page 15's `SSN`, and page 4's, which
 *   shares ONE rule with the printed name beside it. D-HIRE6 seals it everywhere.
 * · **Every `Silvicom Inc Representative:` line** (page 18, page 19 twice) and page 22's
 *   `Company reprsentative's signature`: those are the carrier's countersignature — `p18c`,
 *   `p19ac`, `p19bc`, `p22c` in the placement inventory — and the applicant is not signing them.
 * · **Three of page 22's four `why is this test required` rules.** Q-HM14 (ruled (b), 2026-09-24)
 *   derives the reason from the applicant's structured `applying_as`, and only ONE rule needs a
 *   value from us — see `p22.reason.contracting` below. `Pre-Employment Qualification:` is not
 *   blank at all: ⚠ **the carrier printed `yes` on its rule itself** (a run at x207.6, found
 *   measuring this on 2026-09-24, and in no plan before), exactly as page 19's `Company name:`
 *   carries `Silvicom Inc`. So a company driver's reason is already on the paper, and an
 *   owner-operator's page reads BOTH — the carrier's `yes` and ours. `Suspicion of Controlled
 *   Substance` and `Other` stay blank: nothing the applicant says can decide either.
 * · **Page 31's `Witness Name:`** — `p31w` is `party: "witness"`, a third person the packet
 *   deliberately refuses to assume is either of the other two.
 *
 * ⚠ Coordinates are PDF page points, origin bottom-left, matching `packetTemplate.ts`'s output and
 * the space `pdf-lib` draws in.
 */

/**
 * The identity block pages 18 and 19 both carry, as two measured row sets over one measured set of
 * spans (AUD-17).
 *
 * ── WHY THIS ONE IS GENERATED AND THE TWELVE BELOW ARE NOT ───────────────────────────────────────
 * Same reason `PACKET_FIELD_TABLES` is a table and not 100 cells, and the same limit on it. Pages 18
 * and 19 carry the SAME printed block — `Driver name:` over `Address:` over `City: State: Zip:` over
 * `CDL # State: Exp. Date:` — and the carrier drew all sixteen rules at eight identical x spans.
 * Writing sixteen entries by hand would be sixteen chances to mistype a number no reader could check,
 * and the two rows below are the only judgement in it.
 *
 * ⚠ **BOTH pages were rendered and looked at, not one and assumed.** `source: "seen"` on both row
 * sets means exactly that: the eight spans agreeing across the two pages is something the raster
 * confirmed, not something this constant asserts. If a re-export ever moves one of them,
 * `packetSigningGeometry.test.ts` fails on that page's rules by name rather than quietly drawing
 * page 18's geometry onto page 19.
 *
 * ⚠ **Page 19's block belongs to the LOWER of its two authorizations** (`p19b`), and page 19's
 * `Company name:` row is not in it — the carrier printed `Silvicom Inc` there himself.
 */
const SINGLE_LICENCE_BLOCK_SPANS = {
  driver_name: { x1: 154.1, x2: 553.2, note: "`Driver name:` boxed left, one long rule to the right." },
  address: { x1: 102.5, x2: 553.2, note: "`Address:` boxed left, a full-width rule to the right." },
  city: { x1: 102.5, x2: 257.4, note: "`City:` boxed left, first of the row's three rules." },
  state: { x1: 308.9, x2: 360.6, note: "`State:` boxed at x259, its short rule to the right." },
  zip: { x1: 412.1, x2: 463.8, note: "`Zip:` boxed at x362, its short rule to the right." },
  cdl: { x1: 102.5, x2: 309.0, note: "`CDL #` boxed left; its rule runs under the City/State boundary and stops at 309." },
  cdl_state: { x1: 360.5, x2: 412.2, note: "`State:` boxed at x311 — the LICENCE's state, not the address's." },
  cdl_expires: { x1: 463.7, x2: 553.2, note: "`Exp. Date:` boxed at x414, the row's last rule." },
} as const;

/** Each page's own four rules, top to bottom: name, address, city row, licence row. */
const SINGLE_LICENCE_BLOCK_ROWS = {
  18: { driver_name: 217.0, address: 201.7, city: 186.5, cdl: 171.2 },
  19: { driver_name: 401.3, address: 370.8, city: 340.3, cdl: 309.8 },
} as const;

/** Which of the four rules each of the eight spans sits on. */
const SINGLE_LICENCE_BLOCK_ROW_OF = {
  driver_name: "driver_name", address: "address",
  city: "city", state: "city", zip: "city",
  cdl: "cdl", cdl_state: "cdl", cdl_expires: "cdl",
} as const;

const SINGLE_LICENCE_BLOCK_LINES: readonly PacketFieldLine[] = (
  [18, 19] as const
).flatMap((page) =>
  (Object.keys(SINGLE_LICENCE_BLOCK_SPANS) as Array<keyof typeof SINGLE_LICENCE_BLOCK_SPANS>).map(
    (field): PacketFieldLine => ({
      id: `p${page}.${field}`,
      page,
      x1: SINGLE_LICENCE_BLOCK_SPANS[field].x1,
      x2: SINGLE_LICENCE_BLOCK_SPANS[field].x2,
      y: SINGLE_LICENCE_BLOCK_ROWS[page][SINGLE_LICENCE_BLOCK_ROW_OF[field]],
      source: "seen",
      note: `${page === 18 ? "CERTIFICATE OF SINGLE LICENSE" : "AUTHORIZATION FOR DRIVING RECORD CHECK"} identity block — ${SINGLE_LICENCE_BLOCK_SPANS[field].note}`,
    }),
  ),
);

/** The eight fields of that block, in the carrier's own order — for the module that fills it. */
export const SINGLE_LICENCE_BLOCK_FIELDS = Object.keys(
  SINGLE_LICENCE_BLOCK_SPANS,
) as ReadonlyArray<keyof typeof SINGLE_LICENCE_BLOCK_SPANS>;

/** The two pages that carry it. ⚠ Page numbers, and `p18`/`p19` id prefixes, come from here. */
export const SINGLE_LICENCE_BLOCK_PAGES = [18, 19] as const;

/**
 * Where the signer writes themselves down, on the pages they sign.
 *
 * ⚠ Ids are `p{page}.{what}`, the same vocabulary `packetFieldGeometry.ts` uses, so that a reader of
 * a placed value cannot tell — and does not need to tell — which of the two tables it came from.
 */
export const PACKET_SIGNING_FIELD_LINES: readonly PacketFieldLine[] = [
  { id: "p03.printed_name", page: 3, x1: 50.9, x2: 463.8, y: 320.8, source: "seen",
    note: "One full-width rule with `Printed name` captioned beneath it, above the page's Date/Signature pair — p04's layout." },
  { id: "p04.printed_name", page: 4, x1: 50.9, x2: 305.0, y: 235.1, source: "seen",
    note: "⚠ Stops at 305 because the rule is SHARED with `Social Security Number`, captioned at x310.8 and never drawn (D-HIRE6) — the same correction p10's mark needed in 2026-09-14." },
  { id: "p10.printed_name", page: 10, x1: 102.5, x2: 463.8, y: 185.6, source: "seen",
    note: "`Print name` boxed to the left with its rule to the right — p10's own signature layout one band down, except that this rule is NOT shared with a date." },
  { id: "p22.date", page: 22, x1: 102.5, x2: 205.8, y: 279.4, source: "seen",
    note: "`Date:` boxed left, short rule to its right, ABOVE the `Driver name Print | Driver signatrure` pair. ⚠ The other `Date` on this page belongs to p22c and is the carrier's." },
  /**
   * ⚠ **The owner-operator's reason on page 22** (Q-HM14), drawn as the carrier's own word `yes`
   * because that is how the carrier answered the rule beside it — two answers in one box should not
   * be in two registers. The rule is a short one AFTER the caption, not under it: the caption runs to
   * x~330 and the rule starts at 360.5, just as `Pre-Employment Qualification:`'s rule starts well
   * past its caption's box.
   */
  { id: "p22.reason.contracting", page: 22, x1: 360.5, x2: 412.2, y: 508.0, source: "seen",
    note: "The rule right of `Pre-Qualification for Contracting a Driver/ Owner Operator`, left of `Other`. ⚠ The row above's `Pre-Employment Qualification:` rule already carries the carrier's printed `yes`." },
  { id: "p26.name", page: 26, x1: 50.9, x2: 553.2, y: 610.1, source: "seen",
    note: "Full-width rule under the centred heading `Driver's/ Owner's Name:` — the caption is 35pt above rather than beside or beneath, which no other page does." },
  { id: "p27.date", page: 27, x1: 50.9, x2: 257.4, y: 223.1, source: "seen",
    note: "`Date` captioned beneath its own rule and STACKED above the signature's rather than beside it. p27's anchor says `Signature` alone, which is why this is not a mark-side line." },
  { id: "p28.driver_owner_name", page: 28, x1: 205.7, x2: 463.8, y: 335.8, source: "seen",
    note: "`Driver/Owner Name:` printed on the rule's own baseline to its left, so the value starts where the rule does at 205.7." },
  { id: "p28.date", page: 28, x1: 50.9, x2: 257.4, y: 229.1, source: "sibling",
    note: "p27's layout: `Date` captioned beneath its own rule, stacked below the signature's." },

  /**
   * ⚠ **Page 31's two name blanks are PRINTED UNDERSCORES, not ruled lines** — `Driver name:
   * _________` and `Owner Operator Name:_________` are each one text run, exactly as page 2's
   * `Yes______` is. So `y` is the printed run's baseline minus `FIELD_BASELINE_LIFT`, which puts the
   * value on the underscores, and the test below reads them against the RUN rather than against a
   * rule it would never find.
   *
   * The spans were read off a coordinate ruler drawn across each band at 10pt intervals and
   * rasterised — there is no run whose x could be read for the end of a line of underscores.
   */
  { id: "p31.driver_name", page: 31, x1: 112.0, x2: 292.0, y: 601.2, source: "seen",
    note: "The underscores after the printed `Driver name:`, which end at 292 — the page's own top blank, above the driver's Signature/Date pair." },
  { id: "p31.owner_operator_name", page: 31, x1: 157.0, x2: 428.0, y: 265.8, source: "seen",
    note: "The underscores after `Owner Operator Name:`, above the owner-operator's pair. ⚠ `Witness Name:` below it takes the same shape and is NOT ours — p31w is a third party." },

  /**
   * ⚠ **The packet's only blank in the MIDDLE of a sentence** (AUD-7, 2026-09-19), and that is why
   * AUD-17's sweep found it in neither pass: both passes enumerated ruled lines and caption-led runs,
   * and this is neither. The carrier printed *"I _________ aka (OP) read and understood the agreement
   * above."* as ONE text run — a glyph for `I`, a space, forty-one underscores, then the rest of the
   * sentence — so there is no rule to find and no caption the blank follows.
   *
   * ⚠ **It is bounded on BOTH sides by the carrier's own words, which no other blank in this table
   * is.** Everything else runs to a margin; this one has `aka (OP)` immediately after it, and a value
   * that overruns does not run into white space, it runs into the sentence that gives the name its
   * meaning. Drawn at full length without the fitter it prints straight through `aka (OP)` — which
   * is how `x2` was settled, by rendering exactly that and looking at 300 dpi.
   *
   * ⚠ **`x2` CANNOT BE CHECKED BY A TEST and the test below says so rather than pretending.** The
   * end of a line of underscores is not a run whose x anything can read: the whole sentence is a
   * single `TJ` array with per-glyph kerning, so the interior positions exist only as advance widths
   * inside a font this repo does not parse. Same position as `PAGE_1_NAME_COLUMNS` in
   * `packetFieldGeometry.ts`, and handled the same way — measured off a coordinate ruler drawn
   * across the line at 2pt intervals, confirmed by putting a value under it. What DOES hold the
   * value inside this span at render time is `packetOverlay.test.ts`'s *"draws nothing past the span
   * its geometry gives it"*, which is about the span rather than about this number.
   */
  { id: "p31.aka_op", page: 31, x1: 60.8, x2: 244.0, y: 494.4, source: "seen",
    note: "The forty-one underscores inside `I ____ aka (OP) read and understood the agreement above.` ⚠ Not a rule and not caption-led — a blank mid-sentence, with the carrier's own words on both sides of it." },

  /**
   * ⚠ **Page 26's answer is an X in a BOX, and it is the only two-cell box in the packet.**
   *
   * §40.25(j)'s two-year question — *did you test positive or refuse a pre-employment test for a job
   * you applied for but did not get?* — under `Check appropriate box below`. The carrier drew one
   * bordered box from y457.7 to y427.2 with a divider at x206.2, and captioned the halves `YES` and
   * `NO` BENEATH it.
   *
   * ⚠ `y` is 436, which is **not a rule** — it is the middle of the box, and the difference is
   * visible. An X lifted 3pt off the box's floor rule reads as a mark that missed the box; the same
   * X halfway up reads as a tick. Both were drawn and compared at `-r 150`.
   *
   * ⚠ **Left-aligned in a 103pt cell on purpose**: `YES` and `NO` are captioned at the cells' left
   * edges, so a tick at the left sits directly above the word it answers.
   */
  { id: "p26.prior_test.yes", page: 26, x1: 103.0, x2: 206.2, y: 436.0, source: "seen",
    note: "Left half of the §40.25(j) box, captioned `YES` beneath. The box's own rules are at y457.7 and y427.2." },
  { id: "p26.prior_test.no", page: 26, x1: 206.2, x2: 309.4, y: 436.0, source: "sibling",
    note: "Right half of the same box, captioned `NO` beneath, divided from its sibling at x206.2." },

  ...SINGLE_LICENCE_BLOCK_LINES,
];

/** The line with this id, or null — the signing table's own lookup. */
export const signingLineFor = (id: string): PacketFieldLine | null =>
  PACKET_SIGNING_FIELD_LINES.find((l) => l.id === id) ?? null;
