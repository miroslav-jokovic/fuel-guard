/**
 * EFS currency/unit guard (audit 2026-08-09, Stage 3).
 *
 * The importer reads `Qty` as US gallons and `Amt` as US dollars. The `Currency` column has always
 * been parsed and stored on `efs_transactions` — and never read by anything. The documented ground
 * truth from the real exports is `USD/Gallons`, so for those rows the assumption holds; the danger is
 * the row where it does not. 380 litres billed in CAD, stored as 380 gallons, fires
 * `exceeds_tank_capacity` at CRITICAL against a 150-gal tank and drags `mpg_deviation` and
 * `cumulative_overfuel` with it — a multi-axis theft alert against an honest driver, built entirely
 * out of a unit error.
 *
 * The conservative response is to SKIP such a row with a stated reason, not to convert it. A skipped
 * row is visible in the import review and can be handled deliberately; a converted one silently
 * asserts an exchange rate and a litre/gallon factor this system has no source for.
 *
 * Extracted from parse.ts so that file stays inside the 500-line budget (check-file-size.mjs).
 */
const USD_CURRENCY_TOKENS = new Set(["usd", "us", "usa", "usd$", "$", "usdollar", "usdollars"]);
const CURRENCY_FILLER_TOKENS = new Set(["dollar", "dollars"]);
const GALLON_UNIT_TOKENS = new Set(["gallon", "gallons", "gal", "gals", "usgallon", "usgallons", "usgal"]);

/**
 * Why this row's Currency value disqualifies it, or null when the row may be read as USD/gallons.
 * Splits "USD/Gallons" into its currency and unit halves and requires BOTH to be recognised — an
 * unfamiliar token is a reason to skip, never a licence to assume. Pure.
 */
export function nonUsdGallonsReason(currency: string | null | undefined): string | null {
  const raw = (currency ?? "").trim();
  if (!raw) return null; // absent → the documented USD/Gallons default
  const parts = raw
    .toLowerCase()
    .split(/[/\\|,;\s]+/)
    .map((p) => p.replace(/[^a-z$]/g, ""))
    .filter(Boolean);
  if (parts.length === 0) return null; // punctuation only — the row makes no claim
  if (!USD_CURRENCY_TOKENS.has(parts[0]!)) return `non-USD currency (${raw})`;
  let i = 1;
  while (i < parts.length && CURRENCY_FILLER_TOKENS.has(parts[i]!)) i++;
  if (parts.slice(i).some((u) => !GALLON_UNIT_TOKENS.has(u))) return `non-gallon unit (${raw})`;
  return null;
}
