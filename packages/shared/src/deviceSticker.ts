/**
 * Reading the sticker on the back of a tablet (MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md §7a.6, M9b;
 * owner Q-MX11 (a), 2026-10-28: every tablet has an AT&T SIM and an IMEI, with a barcode sticker).
 *
 * ── WHAT A STICKER CARRIES, AND WHY ONE FUNCTION SORTS IT ───────────────────────────────────────
 * A device sticker (or the box label) prints several Code 128 barcodes side by side: the IMEI, the
 * serial number, often the model, and on a box the retail EAN/UPC and sometimes the SIM's ICCID. The
 * Tera Pro is a keyboard (HID): it types whichever barcode the person aimed at and presses Enter, and
 * nothing in the keystrokes says which one it was. So the person should not have to say either —
 * they scan the barcodes in any order, and `readStickerCode` decides what each one is from its
 * shape. Every rule below is a published format, not a guess about one shop's devices:
 *
 *   · IMEI — 15 digits, the last a Luhn check digit (3GPP TS 23.003). The only common 15-digit
 *     barcode on a device, so 15 digits that fail Luhn are a misread IMEI, never a serial.
 *   · ICCID (the SIM card's number) — 19 or 20 digits starting `89` (ITU-T E.118), Luhn too.
 *   · EAN-13 / UPC-A (the retail box barcode) — 13 or 12 digits with the GS1 check digit.
 *   · Model — only where the maker's own prefix is unambiguous (`MODEL_PREFIXES`).
 *   · Serial — what is left: 6–20 letters and digits. A serial is whatever the maker stamped, so
 *     it is the fall-through, and the person sees which field it went into.
 *
 * Pure, no clock, no I/O: the Add equipment form, the Scan page and the API's IMEI rule all ask it.
 */

/** The message a bad IMEI read gets, on the form and the Scan page alike (handoff M9b). */
export const IMEI_REFUSAL = "That is not an IMEI — scan the barcode marked IMEI.";

/** The Luhn check (ISO/IEC 7812-1), over a string of digits. */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** An IMEI as stored (0527): exactly 15 digits, the last one Luhn's. */
export function isImei(value: string): boolean {
  return /^\d{15}$/.test(value) && luhnValid(value);
}

/** The GS1 check digit (EAN-13, UPC-A): weights 3 and 1 from the right, check digit excluded. */
function gtinValid(digits: string): boolean {
  if (!/^\d{12,13}$/.test(digits)) return false;
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) sum += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

/**
 * Model numbers whose prefix names the maker beyond doubt. Samsung has printed `SM-` on every Galaxy
 * model since 2013 (SM-T575, SM-X306B); Lenovo's tablets are `TB-` (TB-X606F). A model this list does
 * not know is read as a serial — and the form shows where it landed, so a person moves it in one tap.
 */
const MODEL_PREFIXES: ReadonlyArray<{ pattern: RegExp; manufacturer: string }> = [
  { pattern: /^SM-[A-Z]\d{3,4}[A-Z0-9]*$/, manufacturer: "Samsung" },
  { pattern: /^TB-?[A-Z]?\d{3,4}[A-Z0-9]*$/, manufacturer: "Lenovo" },
];

export type StickerCode =
  | { kind: "imei"; imei: string }
  /** Fifteen digits that fail the check digit: the IMEI barcode, misread. Refused with `IMEI_REFUSAL`. */
  | { kind: "bad_imei"; digits: string }
  | { kind: "sim"; iccid: string }
  | { kind: "box_barcode"; gtin: string }
  | { kind: "model"; model: string; manufacturer: string }
  | { kind: "serial"; serial: string }
  | { kind: "unknown"; code: string };

/** What one scanned (or typed) barcode off a device sticker is. */
export function readStickerCode(raw: string): StickerCode {
  const code = raw.trim();
  // A label that prints its caption into the barcode ("IMEI 35…", "S/N: R52…") — rare, harmless to
  // accept. The caption is dropped; spaces and dashes inside a digit run are print formatting.
  // "IMEI1"/"IMEI2" on a dual-SIM label: the 1 or 2 is caption only when a separator follows it.
  const imeiCaptioned = /^IMEI(?:\s*[12](?=[\s:#]))?\s*[:#]?\s*/i.exec(code);
  const digitsOnly = (imeiCaptioned ? code.slice(imeiCaptioned[0].length) : code).replace(/[\s-]/g, "");

  if (/^\d+$/.test(digitsOnly)) {
    if (digitsOnly.length === 15) return isImei(digitsOnly) ? { kind: "imei", imei: digitsOnly } : { kind: "bad_imei", digits: digitsOnly };
    if (imeiCaptioned) return { kind: "bad_imei", digits: digitsOnly };
    if ((digitsOnly.length === 19 || digitsOnly.length === 20) && digitsOnly.startsWith("89")) return { kind: "sim", iccid: digitsOnly };
    if (gtinValid(digitsOnly)) return { kind: "box_barcode", gtin: digitsOnly };
  }

  const bare = code.replace(/^(?:S\/?N|SERIAL(?:\s*NO\.?)?)\s*[:#]?\s*/i, "").toUpperCase();
  for (const m of MODEL_PREFIXES) {
    if (m.pattern.test(bare)) return { kind: "model", model: bare, manufacturer: m.manufacturer };
  }
  if (/^[A-Z0-9]{6,20}$/.test(bare)) return { kind: "serial", serial: bare };
  return { kind: "unknown", code };
}
