/**
 * certificationExemptionFrom — the one place `ResolvedPaper.certificationExempt` is derived from.
 *
 * 49 CFR 172.204(b)(1), eCFR text of 2026-10-09: "Except for a hazardous waste, no certification is
 * required for a hazardous material offered for transportation by motor vehicle and transported: (i) In a
 * cargo tank supplied by the carrier, or (ii) By the shipper as a private carrier except for a hazardous
 * material that is to be reshipped or transferred from one carrier to another."
 *
 * The owner's ruling Q-DR16 maps the engine's `carrierRelationship` (types.ts, tripContext) onto it:
 *   carrier_supplied_cargo_tank      → exempt
 *   private_carrier                  → cannot tell until "not reshipped/transferred" AND "not hazardous
 *                                      waste" are both confirmed, then exempt
 *   shipper_supplied_common_carrier  → not exempt
 *   unknown                          → cannot tell
 * and the regulation's opening words ("Except for a hazardous waste") take precedence over every row: a
 * load KNOWN to be hazardous waste is never exempt. Where hazardous-waste status is unknown on a
 * carrier-supplied cargo tank, the ruling's "exempt" stands — the ruling decided that case, not this code.
 *
 * Returns true (exempt), false (certification required) or null (cannot tell — the paper rule answers
 * `exception_may_apply`). Pure: no clock, no I/O.
 */
import type { LoadInput } from "../types.js";

export type CarrierRelationship = LoadInput["tripContext"]["carrierRelationship"];

export interface CertificationExemptionFacts {
  /** The material is to be reshipped or transferred from one carrier to another; undefined/null = unknown. */
  readonly reshippedOrTransferred?: boolean | null;
  /** The material is a hazardous waste (§171.8); undefined/null = unknown. */
  readonly hazardousWaste?: boolean | null;
}

export function certificationExemptionFrom(relationship: CarrierRelationship, facts: CertificationExemptionFacts = {}): boolean | null {
  if (facts.hazardousWaste === true) return false;
  switch (relationship) {
    case "carrier_supplied_cargo_tank":
      return true;
    case "private_carrier":
      if (facts.reshippedOrTransferred === true) return false;
      return facts.reshippedOrTransferred === false && facts.hazardousWaste === false ? true : null;
    case "shipper_supplied_common_carrier":
      return false;
    default:
      return null;
  }
}
