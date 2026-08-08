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
