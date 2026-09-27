import { AAMVA_ISSUERS } from "./aamvaIssuers.js";
import { toJurisdictionCode } from "./jurisdictions.js";

/**
 * The PDF417 on the back of a licence, read as AAMVA encodes it (APPLICATION-FLOW-V2-PLAN.md §6.6.4,
 * AW5, C3b1).
 *
 * Pure: text in, facts out. The barcode is decoded to text in the browser by `zxing-wasm/reader`
 * (`readLicenceBarcode.ts`, lazy); this is everything after. Every rule below is from the AAMVA DL/ID
 * Card Design Standard (2020), Annex D §D.12, committed with its IIN table under
 * `docs/plans/recruitment/aamva/` — that README says what is known and, as importantly, what is not.
 *
 * ── WHAT A READ IS FOR, AND WHY A FAILURE COSTS NOTHING ───────────────────────────────────────
 * The result pre-fills boxes the driver then checks (§6.6.4: "for the driver to CONFIRM"); it is never
 * recorded as a fact on its own. So every field is independently optional, a value that does not look
 * like what the standard says it is becomes `null` rather than a guess, and anything that is not an
 * AAMVA barcode at all is `null` — the driver types, exactly as they would have without a scanner.
 *
 * ── THE STRUCTURE (§D.12.3, §D.12.4) ──────────────────────────────────────────────────────────
 * `@` LF RS CR, then `ANSI ` (Table D.1 fields 1–5), the 6-digit IIN, the 2-digit AAMVA version, the
 * 2-digit jurisdiction version and the 2-digit number of entries; then that many 10-byte subfile
 * designators (type, 4-digit offset, 4-digit length); then the subfiles, each starting with its type,
 * each element a 3-letter ID followed by its value and a LF, the subfile ended by a CR.
 *
 * ⚠ **Two leniencies, each about how real barcodes are produced rather than about the standard.**
 * (1) The separators are not trusted to be exactly LF/CR: a decoder, a scanner's keyboard wedge or a
 * jurisdiction's printer can turn one into another, so any of LF, CR or RS ends an element. (2) The
 * designator's offset is used when the bytes there begin with its subfile type, and otherwise the
 * type is searched for after the designators — an offset counted in the wrong unit must not lose a
 * barcode whose content is otherwise perfect. Neither lets a non-AAMVA text through: the header is
 * still required.
 */

export interface AamvaAddress {
  line1: string | null;
  line2: string | null;
  city: string | null;
  /** A code from the product's catalogue, or null. */
  state: string | null;
  /** Five digits (a U.S. ZIP), or null — a Canadian postal code is not something this form stores. */
  postalCode: string | null;
}

export interface AamvaLicence {
  /** Table D.1 field 7 — "10" for the 2020 standard. Carried so a surprising read can be traced. */
  aamvaVersion: number;
  iin: string;
  /** The ISSUING jurisdiction, from the IIN — never from the address, which is where the driver lives. */
  issuingState: string | null;
  /** `DAQ`, the customer ID number — the licence number. */
  licenceNumber: string | null;
  familyName: string | null;
  firstName: string | null;
  middleName: string | null;
  /** `YYYY-MM-DD`. */
  dateOfBirth: string | null;
  /** `YYYY-MM-DD`, from `DBA`. */
  expiresOn: string | null;
  address: AamvaAddress;
}

const HEADER_FILE_TYPE = "ANSI ";
/** Table D.1: `@`, LF, RS, CR precede the file type, so it starts at index 4. Allowed a little slack. */
const FILE_TYPE_SEARCH_LIMIT = 16;
const DESIGNATOR_BYTES = 10;
/** The subfiles that carry Tables D.3/D.4 (§D.12.4): a licence, an enhanced licence, an ID card. */
const CARD_SUBFILES = ["DL", "EN", "ID"] as const;
/**
 * Any of these ends an element — see the header's first leniency. LF, CR and RS (Table D.1 fields 2–4)
 * as strings rather than a regex class: a control character in a regex reads as a mistake (and
 * `no-control-regex` says so), and these three are the standard's, on purpose.
 */
const SEPARATORS = ["\r", "\u001e"] as const;
const splitElements = (text: string): string[] =>
  SEPARATORS.reduce((t, sep) => t.replaceAll(sep, "\n"), text).split("\n");
/** §D.12.5: "NONE" for no data, "unavl" for data not available. Neither is a value. */
const NO_VALUE = new Set(["NONE", "UNAVL"]);

/** The Table D.3/D.4 element IDs this reads — every one is checked against the committed standard. */
export const AAMVA_ELEMENTS = {
  licenceNumber: "DAQ",
  familyName: "DCS",
  firstName: "DAC",
  middleName: "DAD",
  dateOfBirth: "DBB",
  expiresOn: "DBA",
  line1: "DAG",
  line2: "DAH",
  city: "DAI",
  state: "DAJ",
  postalCode: "DAK",
} as const;
const E = AAMVA_ELEMENTS;

const ISSUER_CODE = new Map(AAMVA_ISSUERS.map(([iin, name]) => [iin, toJurisdictionCode(name)]));

/** The jurisdiction code for an IIN, derived by name through the product's catalogue (see `aamvaIssuers.ts`). */
export const issuerJurisdiction = (iin: string): string | null => ISSUER_CODE.get(iin) ?? null;

const digits = (s: string, n: number): boolean => s.length === n && /^\d+$/.test(s);

/**
 * An 8-digit date in either of Table D.3's two orders, whichever is a real date.
 *
 * The country (`DCG`) is deliberately not what decides: at most one order can be real. `CCYYMMDD` read
 * as `MMDDCCYY` has a month of 19 or 20; `MMDDCCYY` read as `CCYYMMDD` has a year of 0101–1231. So a
 * barcode whose country is missing, wrong or from a pre-2020 version still gives the right date.
 */
export function aamvaDate(value: string | null): string | null {
  if (value === null || !digits(value, 8)) return null;
  const us = { y: value.slice(4, 8), m: value.slice(0, 2), d: value.slice(2, 4) };
  const ca = { y: value.slice(0, 4), m: value.slice(4, 6), d: value.slice(6, 8) };
  for (const c of [us, ca]) {
    const y = Number(c.y);
    const m = Number(c.m);
    const d = Number(c.d);
    if (y < 1900 || y > 2199 || m < 1 || m > 12 || d < 1) continue;
    const at = new Date(Date.UTC(y, m - 1, d));
    if (at.getUTCMonth() === m - 1 && at.getUTCDate() === d) return `${c.y}-${c.m}-${c.d}`;
  }
  return null;
}

/** `DAK` is F11ANS, a U.S. ZIP zero-filled to nine digits (Table D.3 p.) — the first five are the ZIP. */
function zip(value: string | null): string | null {
  const m = /^(\d{5})(?:-?\d{4})?$/.exec((value ?? "").replace(/\s+$/, ""));
  return m ? m[1]! : null;
}

/** The subfile's text, by its designator when that is honest, else by searching (header, leniency 2). */
function subfileText(raw: string, type: string, offset: number, length: number, afterDesignators: number): string | null {
  if (raw.startsWith(type, offset)) return raw.slice(offset, offset + length);
  const found = raw.indexOf(type, afterDesignators);
  return found < 0 ? null : raw.slice(found);
}

/** The first value of each 3-letter element ID in a subfile (the type itself is its first two bytes). */
function elements(subfile: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const segment of splitElements(subfile.slice(2))) {
    const id = segment.slice(0, 3);
    if (!/^[A-Z]{3}$/.test(id) || out.has(id)) continue;
    // "Use of padding for variable length fields is optional" (§D.12.5.1) — so trailing spaces are padding.
    const value = segment.slice(3).trim();
    if (value !== "" && !NO_VALUE.has(value.toUpperCase())) out.set(id, value);
  }
  return out;
}

/** Read one barcode's text. `null` when it is not an AAMVA card barcode, or says nothing this form uses. */
export function parseAamvaBarcode(raw: string): AamvaLicence | null {
  const at = raw.indexOf(HEADER_FILE_TYPE);
  if (!raw.startsWith("@") || at < 0 || at > FILE_TYPE_SEARCH_LIMIT) return null;
  const h = at + HEADER_FILE_TYPE.length;
  const iin = raw.slice(h, h + 6);
  const version = raw.slice(h + 6, h + 8);
  const entries = raw.slice(h + 10, h + 12);
  if (!digits(iin, 6) || !digits(version, 2) || !digits(entries, 2)) return null;

  const designatorsAt = h + 12;
  const count = Number(entries);
  let fields: Map<string, string> | null = null;
  for (let i = 0; i < count && fields === null; i++) {
    const d = raw.slice(designatorsAt + i * DESIGNATOR_BYTES, designatorsAt + (i + 1) * DESIGNATOR_BYTES);
    const type = d.slice(0, 2);
    if (!(CARD_SUBFILES as readonly string[]).includes(type) || !digits(d.slice(2, 6), 4) || !digits(d.slice(6, 10), 4)) continue;
    const text = subfileText(raw, type, Number(d.slice(2, 6)), Number(d.slice(6, 10)), designatorsAt + count * DESIGNATOR_BYTES);
    if (text !== null) fields = elements(text);
  }
  if (fields === null) return null;

  const get = (id: string): string | null => fields.get(id) ?? null;
  const licence: AamvaLicence = {
    aamvaVersion: Number(version),
    iin,
    issuingState: issuerJurisdiction(iin),
    licenceNumber: get(E.licenceNumber),
    familyName: get(E.familyName),
    firstName: get(E.firstName),
    middleName: get(E.middleName),
    dateOfBirth: aamvaDate(get(E.dateOfBirth)),
    expiresOn: aamvaDate(get(E.expiresOn)),
    address: {
      line1: get(E.line1),
      line2: get(E.line2),
      city: get(E.city),
      state: toJurisdictionCode(get(E.state)),
      postalCode: zip(get(E.postalCode)),
    },
  };
  const said = [
    licence.licenceNumber, licence.dateOfBirth, licence.expiresOn, licence.familyName,
    licence.address.line1, licence.address.city, licence.address.postalCode,
  ].some((v) => v !== null);
  return said ? licence : null;
}
