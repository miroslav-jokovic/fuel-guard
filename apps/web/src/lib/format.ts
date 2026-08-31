/** Small display-only formatters for table cells. Pure, no locale deps. */

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

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const day = iso.slice(0, 10);
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

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
