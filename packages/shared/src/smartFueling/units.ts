/**
 * Precise unit conversions for the fuel solver + HERE truck routing (pure). The audit flagged unit mixing as a
 * silent-failure landmine (kg/cm for HERE, lb/in for US specs, gal for tanks, meters/miles for distance), so all
 * conversions live here with round-trip tests. NOTE: `metersToMiles` in samsara.ts is a DISPLAY helper (rounds
 * to 0.1 mi); these are UNROUNDED for physics — kept separate on purpose, differently named to avoid collision.
 */
export const METERS_PER_MILE = 1609.344;
export const KM_PER_MILE = 1.609344;
export const CM_PER_INCH = 2.54;
export const IN_PER_FOOT = 12;
export const KG_PER_LB = 0.45359237;
export const LITERS_PER_GALLON = 3.785411784;

// distance
export const metersFromMiles = (mi: number): number => mi * METERS_PER_MILE;
export const milesFromMeters = (m: number): number => m / METERS_PER_MILE;
export const kmFromMiles = (mi: number): number => mi * KM_PER_MILE;
export const milesFromKm = (km: number): number => km / KM_PER_MILE;
// length (HERE wants centimeters)
export const cmFromInches = (inch: number): number => inch * CM_PER_INCH;
export const inchesFromCm = (cm: number): number => cm / CM_PER_INCH;
export const inchesFromFeet = (ft: number): number => ft * IN_PER_FOOT;
// weight (HERE wants kilograms)
export const kgFromLb = (lb: number): number => lb * KG_PER_LB;
export const lbFromKg = (kg: number): number => kg / KG_PER_LB;
// volume
export const litersFromGallons = (gal: number): number => gal * LITERS_PER_GALLON;
export const gallonsFromLiters = (l: number): number => l / LITERS_PER_GALLON;
