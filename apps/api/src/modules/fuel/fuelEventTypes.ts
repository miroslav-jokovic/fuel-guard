/**
 * The `fuel_events.event_type` vocabulary, owned here because `fuel` owns the table
 * (docs/ARCHITECTURE.md §3). Writers and readers both name a member of this set instead of repeating
 * a string literal — which is the whole point, because until 2026-09-06 not one of the three readers
 * filtered on the column at all, and a second event type would silently have been counted as the
 * first.
 *
 * WHY A SECOND TYPE EXISTS. A sudden tank-level drop is evidence of siphoning only if the sensor
 * reporting it is one this product has LEARNED to trust. That is not a new judgement: `ruleEligible`
 * gates `tank_fill_short` and `tank_chronic_short` on `vehicles.tank_sensor_reliable`, and
 * `fileDropsFor` (`samsara/samsaraStatsFeed.ts`) gates the feed-derived drop on the same column. The
 * WEBHOOK path did not. So one table, reached two ways, held its rows to two different standards —
 * and since `tank_sensor_reliable` is true for 12 of 195 trucks (6.2%, measured 2026-09-05), the
 * ungated way was the overwhelming majority of it.
 *
 * WHY A SUPPRESSED DROP IS STORED RATHER THAN DISCARDED, which is the opposite of what the feed lane
 * does. The feed lane runs as a job and reports `dropsSuppressedUnreliableSensor` into the `jobs`
 * ledger, so its suppression is countable after the fact. A webhook delivery has no job row. Worse,
 * `readSamsaraWebhookStatus` answers "has this receiver ever received anything?" by COUNTING
 * `fuel_events` rows — so a gate that discarded would make a working receiver report itself as never
 * reached. That is exactly the false reading S1 was built to eliminate, and re-introducing it through
 * the back door of a correctness fix would have been worse than the defect
 * (docs/plans/samsara/SAMSARA-COLLECTION-PLAN.md §S1). Stored under its own type, the receiver can
 * prove it works, SAM-S6 can measure what the gate costs as `tank_sensor_reliable` widens, and no
 * count that means "siphoning" includes it.
 */

/** A tank-level drop on a vehicle whose fuel sensor is learned-reliable. This is siphoning evidence. */
export const FUEL_EVENT_DROP = "fuel_drop";

/**
 * The same drop, on a vehicle whose fuel sensor is not trusted yet. Recorded so the receiver stays
 * observable and the gate stays measurable; never counted as siphoning, never emailed about.
 */
export const FUEL_EVENT_DROP_UNVERIFIED = "fuel_drop_unverified";
