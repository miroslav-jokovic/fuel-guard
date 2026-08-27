import { z } from "zod";

/**
 * Per-brand fuel discount rules — the contract, moved to shared at P6.1 from
 * apps/web/src/features/fueling/useDiscountRules.ts, where it was defined app-locally in
 * exactly the way the contracts rule (ARCHITECTURE §6) and the P6.2 gate forbid: the API
 * validating writes and the web editing them must share one definition or they drift.
 */
// The vocabulary already lives in smartFueling/types.ts as the resolver's DiscountType — this
// array is its zod-enum form for wire validation, kept in lockstep by the satisfies check below.
import type { DiscountType } from "./smartFueling/types.js";
export const DISCOUNT_TYPES = ["flat", "retail_minus", "cost_plus", "per_site", "none"] as const satisfies readonly DiscountType[];

// Named for what it is — the TABLE-ROW shape (snake_case, as fuel_discount_rules stores it).
// Shared already exports `DiscountRule` (camelCase `centsOff`) as the price-RESOLVER's input;
// redefining that name here is exactly the drift the contracts gate forbids, and the compiler
// caught the first attempt.
export const discountRuleRowSchema = z.object({
  brand: z.string().trim().min(1).max(40).toLowerCase(),
  type: z.enum(DISCOUNT_TYPES),
  cents_off: z.number().min(-500).max(500),
});
export type DiscountRuleRow = z.infer<typeof discountRuleRowSchema>;

/** Replace-set semantics: the list IS the org's rules; absent brands are removed. */
export const discountRulesUpdateSchema = z.object({
  rules: z.array(discountRuleRowSchema).max(100),
});
export type DiscountRulesUpdate = z.infer<typeof discountRulesUpdateSchema>;
