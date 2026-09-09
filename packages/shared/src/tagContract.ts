/**
 * The tag vocabulary — what is printed on a label and what a scan resolves (D-INV7, D-INV16;
 * `docs/plans/maintenance/INVENTORY-PLAN.md` §2.4, §2.10).
 *
 * ── WHY THE TAG IS NOT A URL ────────────────────────────────────────────────────────────────────
 * The obvious design encodes `https://app.silvicom.com/t/ABC123` so a stranger's phone camera opens
 * something. It was rejected for two reasons that only get worse with volume. A hostname baked into
 * five hundred printed labels cannot be changed without reprinting five hundred labels, and this
 * product has already been renamed once. And a label on the outside of a trailer, photographed in a
 * yard by anyone, would publish the carrier's vendor to whoever read it. What is printed is an
 * opaque id with a version prefix; the human-readable code is printed beside the symbol so a fogged
 * laminate is still readable by a person (research §4.7).
 *
 * ── THE GRAMMAR ─────────────────────────────────────────────────────────────────────────────────
 *   SIL1:AST:7K3M9P     an inventory asset — a tablet, a fridge, a set of chains
 *   SIL1:BIN:X4Q2VW     a stock line — one part at one location, which is where a count happens
 *
 * Three fields, colon-separated, fixed width. The version prefix is what makes the whole thing
 * decidable: `parseTag` accepts nothing that does not begin `SIL1:`, so a supplier's UPC-A, EAN-13
 * or Code 128 can never be mistaken for one of ours. That is not a happy accident of the format —
 * it is the reason the format leads with letters, because every retail symbology in the shop
 * encodes digits (§2.10). The resolve endpoint tries `parseTag` first and falls through to
 * `parts.upc` on null, and that fall-through is only safe because the two spaces cannot overlap.
 *
 * ── WHY THIS FILE IS IN SHARED AND WHY IT OWNS NO DECODING ──────────────────────────────────────
 * Four things must agree about a tag: the label PDF that prints it, the scanner that reads it, the
 * resolve endpoint that dispatches it, and the typed-entry field a technician uses when the label
 * is unreadable. A second spelling of this grammar anywhere is a class of bug where a label prints
 * fine and scans to nothing. Decoding a camera frame into a string is a different concern and lives
 * with the scanner; encoding a string into a symbol lives in `@silvicom/qr` (D-INV16). This file
 * knows only what the string means.
 *
 * Pure: no clock, no randomness, no I/O. Issuing a NEW id is not here — that needs a source of
 * randomness and a uniqueness check against the database, and lands at I10.
 */

/**
 * The version prefix. It exists so that a tag printed today is still readable after the grammar
 * changes: a future `SIL2:` tag is rejected by this parser rather than silently misread, and the
 * resolver can then decide what to do about it. Bump it only for a change that alters how the
 * remaining fields are interpreted — adding a KIND is not such a change.
 */
export const TAG_VERSION = "SIL1";

/**
 * What a tag can point at. Two kinds today; §2.10 lists the ones the product will want later —
 * `vehicle`/`trailer` for the digital truck file, `inspection` for the printed §396.17 report,
 * `document` for a DQ binder cover, `location` for a shelf, `invite` for a printed invitation.
 * Each of those is one line here plus one `registerTagResolver` call in its owning module (D-INV7).
 *
 * Three characters, alphabetic, so the kind is legible to a person reading a code aloud over a
 * radio and so no kind can be confused with the digits of a UPC.
 */
export const TAG_KINDS = ["AST", "BIN"] as const;
export type TagKind = (typeof TAG_KINDS)[number];

export const TAG_KIND_LABELS: Record<TagKind, string> = {
  AST: "Asset",
  BIN: "Stock line",
};

/**
 * Crockford base32 — the alphabet the id is drawn from.
 *
 * Not RFC 4648 base32, and the difference is the whole point: Crockford excludes `I`, `L`, `O` and
 * `U`. The first three because a technician reading a greasy label aloud, or typing it into the
 * fallback field with gloves on, confuses them with `1`, `1` and `0`; the fourth so that no
 * generated id spells something the shop will screenshot. `parseTag` folds the confusable pairs
 * back rather than rejecting them, which is the half of Crockford that actually earns its keep:
 * a person who types `SIL1:AST:7K3MO9` gets the tag whose id is `7K3M09`.
 *
 * (https://www.crockford.com/base32.html)
 */
export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * How many Crockford characters an id carries.
 *
 * Six, and the number is bounded from both sides. Below: the id must survive being read aloud and
 * typed by hand when a label is unreadable, so it has to be short — six characters is one spoken
 * breath. Above: §2.4 requires the whole payload to fit a version-4 QR symbol, because a 1-inch
 * version-4 tag gives ~0.69 mm modules against a ~0.4 mm phone floor, and a bigger symbol on the
 * same 1-inch label would stop scanning. `SIL1:AST:7K3M9P` is 15 characters; version 4 at ECC-H
 * holds 24 alphanumeric, so there is room for a longer KIND later but not for a longer id.
 *
 * 32^6 is ~1.07 billion, and ids are unique per ORG rather than globally (`tag_code` is unique per
 * org on both `part_stock` and `inventory_assets`), so the space a single carrier draws from is
 * the whole billion. A random 6-character id still collides by birthday at a few thousand tags —
 * roughly 4.5 % odds somewhere in the set by 10,000 — which is why I10's issuance must insert and
 * retry on conflict rather than generate-then-trust. Recorded here because the number that makes
 * that necessary is here.
 */
export const TAG_ID_LENGTH = 6;

export interface ParsedTag {
  version: typeof TAG_VERSION;
  kind: TagKind;
  /** Normalised: upper case, confusables folded. This is the value to look `tag_code` up by. */
  id: string;
}

const isTagKind = (v: string): v is TagKind => (TAG_KINDS as readonly string[]).includes(v);

/**
 * Fold a scanned or typed id to its canonical spelling.
 *
 * Three transformations, each answering something that happens in a shop rather than something
 * that is theoretically possible. Case, because a person typing into the fallback field has no
 * reason to hold shift. `I`/`L` → `1` and `O` → `0`, because those are the pairs Crockford removed
 * the letters for and a human reading a scuffed label WILL guess wrong. Hyphens dropped, because
 * Crockford's own spec allows them as visual separators and a person transcribing six characters
 * off a label naturally groups them.
 *
 * `U` is NOT folded. It is excluded from the alphabet so that no id spells a word, not because it
 * is confusable with anything — a `U` in an input is a genuinely wrong character and rejecting it
 * is more honest than guessing which key was meant.
 */
export function normalizeTagId(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/-/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
}

const isWellFormedId = (id: string): boolean =>
  id.length === TAG_ID_LENGTH && [...id].every((c) => CROCKFORD_ALPHABET.includes(c));

/**
 * Render a tag for printing. The inverse of `parseTag`, and the only place a tag string is built —
 * a template literal spelled out at a call site is how the label and the scanner drift apart.
 *
 * Throws on a malformed id rather than printing something unscannable. A label is expensive in a
 * way a rejected API call is not: it gets printed onto polyester, laminated, and stuck to a truck,
 * and the failure is discovered weeks later by a technician standing in front of the truck.
 */
export function formatTag(kind: TagKind, id: string): string {
  const normalized = normalizeTagId(id);
  if (!isWellFormedId(normalized)) {
    throw new Error(
      `Refusing to format a tag with id "${id}": expected ${TAG_ID_LENGTH} Crockford base32 characters.`,
    );
  }
  return `${TAG_VERSION}:${kind}:${normalized}`;
}

/**
 * Read a scanned or typed string as one of our tags, or `null` if it is not one.
 *
 * `null` is a routine answer and not an error: the resolve endpoint's next move is to try the same
 * string as a supplier UPC (D-INV7), so every barcode in the shop that is not ours arrives here and
 * leaves by that door. What must never happen is the reverse — a UPC parsing as a tag — and the
 * `SIL1:` prefix is what guarantees it, since every retail symbology encodes digits.
 *
 * An unrecognised KIND also returns null rather than a partial parse. The endpoint reports that as
 * `unknown_tag`, which is a different thing from `malformed` and gets different words on screen: a
 * kind this deployment has no resolver for is probably a tag from a newer version of the product,
 * not a damaged label.
 */
export function parseTag(text: string): ParsedTag | null {
  const parts = text.trim().split(":");
  if (parts.length !== 3) return null;

  const [version, rawKind, rawId] = parts as [string, string, string];
  if (version.toUpperCase() !== TAG_VERSION) return null;

  const kind = rawKind.trim().toUpperCase();
  if (!isTagKind(kind)) return null;

  const id = normalizeTagId(rawId);
  if (!isWellFormedId(id)) return null;

  return { version: TAG_VERSION, kind, id };
}
