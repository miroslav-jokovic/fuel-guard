import type { EfsCardStatus } from "./efsCardCatalog.js";

/**
 * The Fuel cards page's URL (`/fuel-cards`), ONE definition read by the page, by Ask AI's `card_holds`
 * link (F21 R4b) and by `open_view` (F21 Step 5, D-AI6; why a contract: `fuelCostsLinkContract.ts`).
 *
 * `status` is ONE catalogue status (`EFS_CARD_STATUSES`, spelled as EFS spells it). The `card_holds`
 * tool's default answer is "Hold OR Fraud", which one parameter cannot say, so it links with a status
 * only when the answer was about one of them; otherwise the link is the page itself.
 *
 * The rest are the page's client-side facets (`matchesCardFilters`), each ONE value:
 * - `unit` is the card's EFS unit PROMPT, matched exactly: text EFS holds, not a vehicle id.
 * - `policy` is the EFS policy number.
 * - `override`, `linked` and `health` are the three yes/no facets, in the vocabularies below.
 *
 * `driver` (the card's driver NAME as EFS prints it) and `search` are left out of the contract on
 * purpose: a link has no rule yet for turning a person's name into the card's spelling.
 */
export const FUEL_CARDS_QUERY_KEYS = {
  status: "status",
  unit: "unit",
  policy: "policy",
  override: "override",
  linked: "linked",
  health: "health",
} as const;

export const FUEL_CARDS_OVERRIDE = ["active", "none"] as const;
export const FUEL_CARDS_LINKED = ["linked", "unlinked"] as const;
export const FUEL_CARDS_HEALTH = ["errors", "ok"] as const;

export interface FuelCardsLinkFilters {
  status?: EfsCardStatus;
  unit?: string;
  policy?: string;
  override?: (typeof FUEL_CARDS_OVERRIDE)[number];
  linked?: (typeof FUEL_CARDS_LINKED)[number];
  health?: (typeof FUEL_CARDS_HEALTH)[number];
}

export function fuelCardsToQuery(f: FuelCardsLinkFilters): Record<string, string> {
  const K = FUEL_CARDS_QUERY_KEYS;
  const q: Record<string, string> = {};
  if (f.status) q[K.status] = f.status;
  if (f.unit) q[K.unit] = f.unit;
  if (f.policy) q[K.policy] = f.policy;
  if (f.override) q[K.override] = f.override;
  if (f.linked) q[K.linked] = f.linked;
  if (f.health) q[K.health] = f.health;
  return q;
}
