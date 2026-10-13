/**
 * Which BASICs this engine reproduces FMCSA exactly for, and what is still unexplained in the rest
 * (D-IC6: no impact figure is shown for a BASIC until the calculator equals FMCSA there).
 *
 * Measured 2026-10-11 against the 2026-08-28 snapshot (`tests/parity.test.ts`, which fails if this
 * table and the measurement disagree in either direction). Every violation FMCSA scored, we score
 * with identical severity, OOS and time weight. In HM Compliance we ALSO score 14 violations FMCSA
 * left out: shipping-paper, marking, label and placard duties the HMR puts on the shipper, which SMS
 * drops as "assigned exclusively to another entity" by a flag the public data does not carry (plan
 * Q-IC9). Unsafe Driving joined the verified set on 2026-10-13, when the post-crash rule explained its
 * one extra.
 */
import type { SmsBasic } from "./basics.js";

export const SMS_PARITY: Record<SmsBasic, { verified: boolean; note: string }> = {
  vehicle_maintenance: { verified: true, note: "440 of 440 scored violations reproduced; none extra" },
  hos_compliance: { verified: true, note: "97 of 97 reproduced; none extra" },
  driver_fitness: { verified: true, note: "6 of 6 reproduced; none extra" },
  controlled_substances_alcohol: { verified: true, note: "2 of 2 reproduced; none extra" },
  unsafe_driving: {
    verified: true,
    note: "99 of 99 scored violations reproduced; none extra since the post-crash rule (2026-10-13, Q-IC9: 392.2LC on post-crash inspection 4179180099 is not scored)",
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
