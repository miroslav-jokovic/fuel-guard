import { formatDisplayDate, type FleetIdleVerdict, type IdleCostBasis, type IdleTotalPricing } from "@silvicom/shared";

/**
 * The lines beside the Idling page's two dollar totals: what each one covers, how it was priced, and how
 * far the data reaches (design verdict 2026-10-03, move 4: "show coverage and freshness beside each
 * estimate").
 *
 * ── WHY THE OLD PRICE LINE HAD TO GO ─────────────────────────────────────────────────────────────
 * It printed the cost basis ("$5.87/gal · live truck-stop prices"), but the dollars beside it are priced
 * per day at that day's diesel price (`avoidableCostByDay`), and the basis is only the fallback for a day
 * with none. So the card named a price that most of its dollars were not charged at, and said nothing
 * about how many days did fall back. The lines below state the blended price the total actually carries
 * and count the fallback days; the burn rate is stated too, since every idle dollar is hours × that rate.
 *
 * Pure, so every word is testable without a DOM.
 */

const usd3 = (n: number) => `$${n.toFixed(3)}`;
const count = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** Where the fallback price came from, in the reader's words. */
const SOURCE: Record<IdleCostBasis["priceSource"], string> = {
  truck_stops: "the recent truck-stop median",
  settings: "the price in Idle settings",
  default: "a default estimate",
};

/**
 * "Idle data through 10/02/2026. The cards are fleet totals; …" — beside the "Showing" chip, which already
 * names the range. It also says the table's search and filters do not narrow the cards (audit copy note 9:
 * the cards read as filtered).
 */
export function idleScopeLine(fleet: Pick<FleetIdleVerdict, "throughDay">): string {
  const reach = fleet.throughDay ? `Idle data through ${formatDisplayDate(fleet.throughDay)}` : "No idle data in this range yet";
  return `${reach}. The cards are fleet totals; the search and filters below narrow the table, not them.`;
}

/**
 * How one total was priced. Null when it charged nothing, because a price for no gallons is not a fact.
 */
export function idlePricingLine(pricing: IdleTotalPricing, basis: IdleCostBasis): string | null {
  if (pricing.blendedPricePerGal == null) return null;
  const rate = `${basis.idleGalPerHour.toFixed(2)} gal an hour idling`;
  const days = pricing.pricedDays + pricing.unpricedDays;
  const lead = `At ${rate}, each day at that day's diesel price (${usd3(pricing.blendedPricePerGal)}/gal on average).`;
  if (pricing.unpricedDays === 0) return lead;
  return `${lead} ${pricing.unpricedDays} of ${count(days, "day", "days")} had no price and used ${usd3(basis.fuelPricePerGal)}/gal, ${SOURCE[basis.priceSource]}.`;
}

/** Which trucks the avoidable total counts. Equipment decides who CAN be blamed; data decides who is counted. */
export function avoidableCoverageLine(fleet: Pick<FleetIdleVerdict, "confidentTrucks" | "totalTrucks">): string {
  const out = fleet.totalTrucks - fleet.confidentTrucks;
  const lead = `Counts ${fleet.confidentTrucks.toLocaleString("en-US")} of ${count(fleet.totalTrucks, "truck", "trucks")}`;
  return out > 0 ? `${lead}; ${out.toLocaleString("en-US")} with too little data ${out === 1 ? "is" : "are"} left out.` : `${lead}.`;
}

/**
 * Which trucks the equipment total counts: a truck with rest idle an APU would carry, seen for at least half
 * the range. The rest are not "missing" — most had no such idle — so the line names that reason, and the thin
 * ones apart, rather than leaving "20 of 24" for the reader to explain.
 */
export function reducibleCoverageLine(fleet: Pick<FleetIdleVerdict, "reducibleTrucks" | "totalTrucks" | "thinTrucks">): string {
  const lead = `From ${fleet.reducibleTrucks.toLocaleString("en-US")} of ${count(fleet.totalTrucks, "truck", "trucks")}: the ones with rest idle an APU would carry`;
  return fleet.thinTrucks > 0
    ? `${lead}. ${fleet.thinTrucks.toLocaleString("en-US")} seen for under half the range ${fleet.thinTrucks === 1 ? "is" : "are"} left out.`
    : `${lead}.`;
}
