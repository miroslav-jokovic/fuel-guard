/**
 * Diesel fuel tax — the versioned per-jurisdiction table and the landed-cost arithmetic over it
 * (F10). Pure: no clock, no I/O, no org configuration. Read `taxTable.ts` first; its header states
 * the scope every surface is required to repeat, which is PURCHASE-STATE tax and not IFTA-net.
 */
export * from "./taxTable.js";
export * from "./rates2026.js";
export * from "./landedCost.js";
export * from "./taxPremium.js";
