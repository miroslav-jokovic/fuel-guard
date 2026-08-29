import type { FixedCostCategory } from "@silvicom/shared";

/**
 * Display names for the five fixed-cost categories.
 *
 * The page used to render the enum values themselves — a filter and a table column reading "lease",
 * "gps", "permit" in lower case, which is the database's vocabulary rather than the reader's. The
 * enum stays exactly as it is; only what a person sees changes (owner ruling 2026-08-29).
 */
export const FIXED_COST_CATEGORY_LABELS: Record<FixedCostCategory, string> = {
  lease: "Truck lease",
  insurance: "Insurance",
  gps: "GPS and tracking",
  permit: "Permits and licences",
  other: "Other",
};
