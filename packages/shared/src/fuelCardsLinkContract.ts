import type { EfsCardStatus } from "./efsCardCatalog.js";

/**
 * The Fuel cards page's URL (`/fuel-cards`) for the key a link sets, read by the page and by Ask AI's
 * `card_holds` link (F21 R4b, D-AI6; why: `fuelCostsLinkContract.ts`).
 *
 * `status` is ONE catalogue status (`EFS_CARD_STATUSES`, spelled as EFS spells it). The tool's default
 * answer is "Hold OR Fraud", which one parameter cannot say, so it links with a status only when the
 * answer was about one of them; otherwise the link is the page itself.
 */
export const FUEL_CARDS_QUERY_KEYS = { status: "status" } as const;

export const fuelCardsToQuery = (f: { status: EfsCardStatus }): Record<string, string> => ({ [FUEL_CARDS_QUERY_KEYS.status]: f.status });
