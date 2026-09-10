import { z } from "zod";

/**
 * What goes on a label, and what a print run asks for (INVENTORY-PLAN.md I10; D-INV18, D-INV25).
 *
 * ── THE PRESET ID IS A STRING HERE AND AN ENUM IN `@silvicom/qr`, ON PURPOSE ───────────────────
 * `LABEL_PRESET_IDS` is the authority on which sheets exist, and it lives in `@silvicom/qr` beside
 * the geometry it names — a preset is its margins, its pitch and its column count, and an id
 * detached from those is half a fact. The obvious tidy is to re-export that enum through this file
 * so the contract can validate it, and it is the wrong move for one measurable reason: **shared is
 * compiled for React Native** (`build:rn`), so a dependency added here reaches the driver app's
 * bundle, and `@silvicom/qr` carries `uqr`. The driver app will never print a label (I13 is the
 * kit, on a phone, with no printer in the truck), so that is a QR encoder shipped to 286 drivers
 * to type one field.
 *
 * So the id crosses the wire as a bounded string and **the API validates it against
 * `LABEL_PRESET_IDS` at the edge**, where importing the package is free. Both callers that care —
 * `apps/api` and `apps/web` — import the real list directly. That is one authority with a
 * deliberately thin contract, not a fact restated twice: nothing anywhere spells out a second copy
 * of the five ids.
 *
 * ── A FACE IS WHAT IS PRINTED, AND IT IS DERIVED ONCE FOR BOTH RENDERERS ──────────────────────
 * The step's done-when asks that "the preview and the PDF are pixel-compared for one preset", which
 * is only meaningful if the two are drawing the same thing. They are: the API answers with
 * `LabelFaceDto[]`, the PDF draws from it, and the web preview draws from the identical array. The
 * alternative — the server composing a caption for the PDF while the browser composes its own for
 * the preview — is two spellings of one label, and the failure mode is a preview that looks right
 * and a sheet of polyester that does not.
 */

/**
 * Which thing to label.
 *
 * A stock line is named by the PAIR that identifies it — one part at one location — because that is
 * its primary key and there is no surrogate id to send. An asset has one.
 */
export const labelTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("stock"), partId: z.uuid(), locationId: z.uuid() }),
  z.object({ kind: z.literal("asset"), assetId: z.uuid() }),
]);
export type LabelTarget = z.infer<typeof labelTargetSchema>;

/**
 * The most labels one run may ask for.
 *
 * 240 is ten full sheets of the 24-up default, and the bound exists because the request issues a
 * tag code per target and renders a PDF in memory. A shop re-labelling an aisle asks for twenty; a
 * shop labelling everything it owns for the first time asks for a few hundred and can do it in
 * batches, which is also how it will physically peel and stick them.
 */
export const MAX_LABELS_PER_RUN = 240;

/**
 * How far a whole sheet may be nudged, in PostScript points (72 to the inch).
 *
 * ±36 pt is ±½ inch, which is far more than any real printer's registration error and still small
 * enough that a nudge cannot walk a label off its backing square. Avery's own diagnostic is why the
 * control is a whole-sheet offset at all: a UNIFORM shift is a margin problem a nudge fixes, while
 * drift that grows down the page is a scaling problem it cannot — that one is solved by printing at
 * 100 %, and the label screen says so rather than offering a scale control that would hide it.
 */
export const MAX_NUDGE_POINTS = 36;

export const labelRunSchema = z.object({
  /** Validated against `LABEL_PRESET_IDS` at the API edge — see the header. */
  presetId: z.string().min(1).max(32),
  /** 1-based, and bounded per preset by the API: a 24-up sheet has no position 30. */
  startPosition: z.number().int().min(1).max(60).optional(),
  nudgeX: z.number().min(-MAX_NUDGE_POINTS).max(MAX_NUDGE_POINTS).optional(),
  nudgeY: z.number().min(-MAX_NUDGE_POINTS).max(MAX_NUDGE_POINTS).optional(),
  targets: z.array(labelTargetSchema).min(1).max(MAX_LABELS_PER_RUN),
});
export type LabelRun = z.infer<typeof labelRunSchema>;

/** Issuing tags needs no sheet — the preview asks for the faces and lays them out itself. */
export const labelFacesRequestSchema = z.object({
  targets: z.array(labelTargetSchema).min(1).max(MAX_LABELS_PER_RUN),
});
export type LabelFacesRequest = z.infer<typeof labelFacesRequestSchema>;

/**
 * One printed label, resolved.
 *
 * `payload` is the exact string the symbol encodes and is built by `formatTag` — never by a template
 * literal at a call site, which is how a label and a scanner drift apart (`tagContract.ts` says so
 * at length, and this is the file that would have done it).
 *
 * `code` is the human-readable line printed beside the symbol, and the two kinds answer it
 * differently for a reason D-INV18 settles. An asset has TWO identifiers: the opaque `tagCode` in
 * the QR and the sequential `displayNo` (`A-0412`) that a person says out loud — so `A-0412` is
 * what gets printed. A stock line has only the opaque one, so that is what is printed, and it is
 * still the thing that matters: when a laminate fogs, the printed characters are the only way back
 * to the row (research §4.7).
 */
export const labelFaceSchema = z.object({
  target: labelTargetSchema,
  payload: z.string().min(1),
  code: z.string().min(1),
  /**
   * What the thing IS, in at most two lines, longest-lived fact first. A bin gets the part number
   * then the location; an asset gets its name. Lines rather than one string because the renderers
   * set them at different sizes and a caller that had to split a caption on a separator would be
   * re-deriving a decision this file already made.
   */
  lines: z.array(z.string()).max(2),
});
export type LabelFaceDto = z.infer<typeof labelFaceSchema>;
