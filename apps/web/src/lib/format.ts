/** Small display-only formatters for table cells. Pure, no locale deps. */

import { formatDisplayDate, formatDisplayDateRange, formatDisplayDateTime } from "@silvicom/shared";

/**
 * Format a US/NANP phone number for display: "(512) 555-0134".
 *
 * Samsara stores phones in mixed shapes ("+15125550134", "5125550134",
 * "512-555-0134", "(512) 555-0134"). We normalise to digits, then render the
 * canonical 10-digit form (optionally with a leading "+1" country prefix).
 * Anything that isn't a clean 10- or 11-digit (leading 1) US number is returned
 * trimmed and unchanged — better to show the raw value than to mangle an
 * international or extension-bearing number into a wrong shape.
 */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "—";
  const trimmed = raw.trim();
  if (!trimmed) return "—";
  const digits = trimmed.replace(/\D/g, "");
  const ten =
    digits.length === 10 ? digits : digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : null;
  if (!ten) return trimmed; // not a plain NANP number — leave it as the source had it
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/**
 * The number a device dials or texts for a stored phone — the body of a `tel:`/`sms:` link — or null
 * when there is nothing a phone could dial.
 *
 * Reads the same mixed Samsara shapes `formatPhone` does, and agrees with it on what a US number is:
 * a clean 10-digit (or leading-1 11-digit) number dials as `+1XXXXXXXXXX`, so a phone roaming abroad
 * or set to another region still reaches it. Anything else keeps its own `+` and digits — an
 * international number is dialled as stored rather than guessed at — and fewer than seven digits is
 * not a phone number at all ("ext. 4", "n/a"), so it gets no link rather than a link that dials junk.
 */
export function phoneDialString(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length < 7) return null;
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

/**
 * The product's date, `MM/DD/YYYY`, defined once in `@silvicom/shared` (D-DS17, extended from the
 * picker to the whole product on 2026-09-20).
 *
 * These stay as named re-exports rather than being deleted in favour of the shared names: 14 modules
 * already import `formatDate` from here, and a rename touching all of them would bury the one change
 * that matters — the shape of the string — in an import churn nobody could review. The definition is
 * shared; only the local name survives.
 */
export const formatDate = formatDisplayDate;
export const formatDateTime = formatDisplayDateTime;
export const formatDateRange = formatDisplayDateRange;

/**
 * `formatDateTime` for a cell that may be narrower than the whole stamp — a phone card's figure, a
 * card's details: the line may break between the date and the time, and nowhere else.
 *
 * Two ways a stamp went wrong in a 390 px card (owner, 2026-11-22, Loads and Dispatch board in the
 * installed app). Held on one line with `whitespace-nowrap`, the board's Available badge ran 9 px
 * past the card's edge at 390 px and 33 px at 320 px, scrolling the whole page sideways. Left to
 * wrap freely, Loads broke "10/26/2026 8:45 AM" before its "AM". One no-break space, between the
 * minutes and the meridiem, leaves the space after the date as the one ordinary break, so the stamp
 * is one line where it fits and "10/26/2026 / 8:45 AM" where it does not. A date is never split
 * either way (a slash between digits is no break), except by a card's own `overflow-wrap: anywhere`,
 * the last resort for a column narrower than one date.
 *
 * Derived from `formatDateTime`, never a second format: the string is the same one, with one space
 * swapped. Pinned by "breaks between the date and the time, and nowhere else".
 */
export const formatDateTimeWrapping = (...args: Parameters<typeof formatDisplayDateTime>): string =>
  formatDisplayDateTime(...args).replace(/ (AM|PM)$/, "\u00a0$1");

/**
 * What a driver edit turned out to mean, as a sentence — or null when it meant only itself (R6a).
 *
 * The two flags `resolveDriverUpdate` returns are not confirmations that a save worked; they are
 * consequences the person did not necessarily ask for. Claiming a row from telematics stops it being
 * enriched, permanently; stamping a termination date starts the §391.51(c) retention clock. Both
 * deserve a sentence, and D-ROS1 refused a cell-editor grid precisely because it had nowhere to put
 * one.
 *
 * Returns null rather than "Saved." so a caller renders no second line for an ordinary edit.
 */
export function describeDriverEdit(result: {
  claimedFromTelematics: boolean;
  stampedTerminationDate: boolean;
}): string | null {
  const said: string[] = [];
  if (result.claimedFromTelematics) {
    said.push("This driver is now maintained here rather than by the sync.");
  }
  if (result.stampedTerminationDate) {
    said.push("Today was recorded as their termination date.");
  }
  return said.length ? said.join(" ") : null;
}
