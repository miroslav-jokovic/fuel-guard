/**
 * The financial store's API contract (P5.1/P5.2, D-SEP7) — the shape /api/accounting,
 * /api/billing and /api/maintenance answer with, and the ONLY way a client sees
 * financial_entries (deny-all RLS; there is no PostgREST path and never should be).
 *
 * The category vocabulary mirrors 0257's CHECK constraint exactly — machine tokens here,
 * labels beside them, per the house rule that a state vocabulary ships as both.
 */

export const FINANCIAL_CATEGORIES = [
  "fuel",
  "driver_pay",
  "contractor_pay",
  "ap_expense",
  "office",
  "maintenance",
  "linehaul_revenue",
  "accessorial_revenue",
  "other",
] as const;
export type FinancialCategory = (typeof FINANCIAL_CATEGORIES)[number];

export const FINANCIAL_CATEGORY_LABELS: Record<FinancialCategory, string> = {
  fuel: "Fuel",
  driver_pay: "Driver pay",
  contractor_pay: "Contractor pay",
  ap_expense: "AP expense",
  office: "Office",
  maintenance: "Maintenance",
  linehaul_revenue: "Linehaul revenue",
  accessorial_revenue: "Accessorial revenue",
  other: "Other",
};

export const FINANCIAL_DIRECTIONS = ["earning", "expense"] as const;
export type FinancialDirection = (typeof FINANCIAL_DIRECTIONS)[number];

/** One row of the canonical money fact, as the API serves it. */
export interface FinancialEntryDto {
  id: string;
  direction: FinancialDirection;
  category: FinancialCategory;
  amount: number | string;
  occurred_at: string;
  settled_at: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
  source: string;
  source_table: string;
  external_id: string;
  lifecycle_stage: string;
  is_canonical: boolean;
  is_void: boolean;
  ledger_account: string | null;
}
