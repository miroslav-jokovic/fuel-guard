/**
 * Diesel tax rates per jurisdiction, by IFTA quarter — MINTED, NEVER HAND-EDITED.
 *
 * Cut by `node scripts/fetch-ifta-rates.mjs 1Q2026 2Q2026 3Q2026` on 2026-08-26 from the
 * IFTA, Inc. Tax Rate Matrix (https://www.iftach.org/taxmatrix4/Taxmatrix.php), Special Diesel column,
 * U.S. cents-per-gallon. That script's header explains the cross-quarter gate it passed to be written.
 *
 * Read `taxTable.ts` before using any number here: `pumpPerGal` is what a gallon carries AT THE PUMP
 * in that jurisdiction and `returnSurchargePerGal` is emphatically not — a surcharge is billed on the
 * quarterly IFTA return over the miles BURNED there, so it belongs to a jurisdiction this product
 * cannot yet see (Q-FX4). A `null` rate is unknown or not levied per gallon and is never zero.
 */
import type { DieselTaxQuarter } from "./taxTable.js";

const PUMP_1Q2026 = {
  AL: 0.3100, AR: 0.2850, AZ: 0.2600, CA: 0.9710, CO: 0.3250, CT: 0.4890,
  DE: 0.2200, FL: 0.4027, GA: 0.3710, IA: 0.3250, ID: 0.3200, IL: 0.7380,
  IN: 0.6100, KS: 0.2600, KY: 0.2200, LA: 0.2000, MA: 0.2400, MD: 0.4675,
  ME: 0.3120, MI: 0.5240, MN: 0.3260, MO: 0.2950, MS: 0.2100, MT: 0.2975,
  NC: 0.4100, ND: 0.2300, NE: 0.3180, NH: 0.2220, NJ: 0.5610, NM: 0.2100,
  NV: 0.2700, NY: 0.3805, OH: 0.4700, OK: 0.1900, OR: null, PA: 0.7410,
  RI: 0.4000, SC: 0.2800, SD: 0.2800, TN: 0.2700, TX: 0.2000, UT: 0.3790,
  VA: 0.3270, VT: 0.3100, WA: 0.5840, WI: 0.3290, WV: 0.3570, WY: 0.2400,
} as const satisfies Record<string, number | null>;

const SURCHARGE_1Q2026 = { KY: 0.1050, VA: 0.1430 } as const satisfies Record<string, number>;

const PUMP_2Q2026 = {
  AL: 0.3100, AR: 0.2850, AZ: 0.2600, CA: 0.9710, CO: 0.3250, CT: 0.4890,
  DE: 0.2200, FL: 0.4097, GA: 0.3730, IA: 0.3250, ID: 0.3200, IL: 0.7380,
  IN: 0.6300, KS: 0.2600, KY: 0.2200, LA: 0.2000, MA: 0.2400, MD: 0.4675,
  ME: 0.3120, MI: 0.5240, MN: 0.3260, MO: 0.2950, MS: 0.2100, MT: 0.2975,
  NC: 0.4100, ND: 0.2300, NE: 0.3180, NH: 0.2220, NJ: 0.5610, NM: 0.2100,
  NV: 0.2700, NY: 0.3805, OH: 0.4700, OK: 0.1900, OR: null, PA: 0.7410,
  RI: 0.4000, SC: 0.2800, SD: 0.2800, TN: 0.2700, TX: 0.2000, UT: 0.3790,
  VA: 0.3270, VT: 0.3100, WA: 0.5840, WI: 0.3290, WV: 0.3570, WY: 0.2400,
} as const satisfies Record<string, number | null>;

const SURCHARGE_2Q2026 = { KY: 0.1050, VA: 0.1430 } as const satisfies Record<string, number>;

const PUMP_3Q2026 = {
  AL: 0.3100, AR: 0.2850, AZ: 0.2600, CA: 0.9790, CO: 0.3350, CT: 0.4990,
  DE: 0.2200, FL: 0.4097, GA: 0.3730, IA: 0.3250, ID: 0.3200, IL: 0.7380,
  IN: 0.6300, KS: 0.2600, KY: 0.2200, LA: 0.2000, MA: 0.2400, MD: 0.4745,
  ME: 0.3120, MI: 0.5240, MN: 0.3260, MO: 0.2950, MS: 0.2400, MT: 0.2975,
  NC: 0.4100, ND: 0.2300, NE: 0.3180, NH: 0.2220, NJ: 0.5610, NM: 0.2100,
  NV: 0.2700, NY: 0.3805, OH: 0.4700, OK: 0.1900, OR: null, PA: 0.7410,
  RI: 0.4000, SC: 0.2800, SD: 0.2800, TN: 0.2700, TX: 0.2000, UT: 0.3790,
  VA: 0.3360, VT: 0.3100, WA: 0.5950, WI: 0.3290, WV: 0.3570, WY: 0.2400,
} as const satisfies Record<string, number | null>;

const SURCHARGE_3Q2026 = { KY: 0.1050, VA: 0.1430 } as const satisfies Record<string, number>;

export const DIESEL_TAX_QUARTERS: readonly DieselTaxQuarter[] = [
  {
    version: "1Q2026",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-03-31",
    final: true,
    notFinalUntil: null,
    capturedOn: "2026-08-26",
    pumpPerGal: PUMP_1Q2026,
    returnSurchargePerGal: SURCHARGE_1Q2026,
  },
  {
    version: "2Q2026",
    effectiveFrom: "2026-04-01",
    effectiveTo: "2026-06-30",
    final: true,
    notFinalUntil: null,
    capturedOn: "2026-08-26",
    pumpPerGal: PUMP_2Q2026,
    returnSurchargePerGal: SURCHARGE_2Q2026,
  },
  {
    version: "3Q2026",
    effectiveFrom: "2026-07-01",
    effectiveTo: "2026-09-30",
    final: false,
    notFinalUntil: "September 4, 2026",
    capturedOn: "2026-08-26",
    pumpPerGal: PUMP_3Q2026,
    returnSurchargePerGal: SURCHARGE_3Q2026,
  },
];
