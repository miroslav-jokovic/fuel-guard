/**
 * IFTA — the arithmetic over the stored jurisdiction miles (S2). Pure: no clock, no I/O, no org
 * configuration. This is where Samsara's metres become miles, using `smartFueling/units.ts`'s
 * conversions rather than any of its own: that module already holds unrounded, round-trip-tested
 * `milesFromMeters` and `gallonsFromLiters`, and its header already explains that `samsara`'s
 * `metersToMiles` is the DISPLAY helper. A third copy was written here and deleted; the barrel
 * collision that exposed it is the only reason it did not ship.
 */
export * from "./position.js";
export * from "./tieOut.js";
