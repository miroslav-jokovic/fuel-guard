/**
 * Which BASICs this engine reproduces FMCSA exactly for, and what is still unexplained in the rest
 * (D-IC6: no impact figure is shown for a BASIC until the calculator equals FMCSA there).
 *
 * Measured 2026-10-11 against the 2026-08-28 snapshot (`tests/parity.test.ts`, which fails if this
 * table and the measurement disagree in either direction). Every violation FMCSA scored, we score
 * with identical severity, OOS and time weight. In two BASICs we ALSO score violations FMCSA left
 * out, for a reason its public data does not show; plan Q-IC9 holds the candidates.
 */
import type { SmsBasic } from "./basics.js";

export const SMS_PARITY: Record<SmsBasic, { verified: boolean; note: string }> = {
  vehicle_maintenance: { verified: true, note: "440 of 440 scored violations reproduced; none extra" },
  hos_compliance: { verified: true, note: "97 of 97 reproduced; none extra" },
  driver_fitness: { verified: true, note: "6 of 6 reproduced; none extra" },
  controlled_substances_alcohol: { verified: true, note: "2 of 2 reproduced; none extra" },
  unsafe_driving: {
    verified: false,
    note: "every scored violation reproduced, plus 1 FMCSA did not score: 392.2LC on 4179180099 (IL, 2024-10-19), ticketed, no court result in the feed (Q-IC9)",
  },
  hm_compliance: {
    verified: false,
    note: "every scored violation reproduced, plus 14 FMCSA did not score: shipping-paper, marking, label and placard codes on 7 placarded inspections (Q-IC9)",
  },
};

/** True when an SMS impact figure for this BASIC may be shown. */
export function smsImpactVerified(basic: SmsBasic): boolean {
  return SMS_PARITY[basic].verified;
}
