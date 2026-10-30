/**
 * "Should carry" — kit rules and the shortfalls they produce — is HIDDEN (owner, 2026-10-30, Q-EA3;
 * EQUIPMENT-ASSIGN-BY-SCAN-PROPOSAL.md §4, EA2).
 *
 * The kit layer (I9: fleet rules per kind of unit, per-unit overrides, each type's own default, and
 * "Missing N" wherever a unit falls short) was built before equipment was assigned from the truck it
 * goes on. Production has zero rules, and the one type it has carries a default of 200 — typed into
 * "how many a truck carries by default" as if it were how many the shop owns (measured 2026-10-30). So
 * every screen showing the layer could only show nothing, or nonsense the day a truck is first checked.
 * Assigning by scan and checking by scan answer "what is on this truck" and "is it still there"
 * without it.
 *
 * The ruling is to hide it and KEEP the code — built, tested and gated, as `SHELF_COUNTING_SHOWN` keeps
 * the shelves. It is here in shared, not in the web app, because the server is one of its readers: the
 * Trucks & trailers worklist (`unitAttention.ts`) names "missing equipment" as a reason, and a hidden
 * layer that still put trucks on that list would be a reason nobody can see or fix.
 *
 * What it hides: the "Should carry" table, its override and fleet-rules drawers, the kit state badge
 * and "Missing N" on a truck's Equipment tab, Equipment's "What each truck should carry" button and
 * "Missing something" filter, the default-quantity field and the standard-kit button on Types of
 * equipment, and the worklist's "missing equipment" reason. The kit still derives — the unit check
 * lists what a truck holds from the same read — it is only never shown as a shortfall.
 */
export const KIT_RULES_SHOWN = false;
