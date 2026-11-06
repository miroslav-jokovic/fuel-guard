/**
 * Where a carrier's outcome feed sends, and whether it may send at all (B6; D-AD14 "disabled per org by a
 * switch"). The Conversions API writes to a DATASET (`POST /{dataset_id}/events`). Nothing stored today names
 * one: `ads_platform_connections` holds an ad account and a Page, and Settings › Ads control has no outcome
 * group. Q-AD40 (ADS-AGENT-PLAN §9) asks where the switch and the dataset id live: the versioned settings
 * (Track S's screen) or the connection that Connect discovers.
 *
 * ── THIS IS A SEAM, NOT A DEFAULT ────────────────────────────────────────────────────────────────
 * The feed reads a carrier's target only through this interface, handed in at the composition root. Until
 * Q-AD40 is ruled and its source built, the one production implementation answers `null` for every carrier
 * (`NO_FEED_TARGET`): the feed is OFF everywhere, and the scheduler queues nothing. That is also the only safe
 * state before L4. The feed has not been certified against the sandbox, and V3 (Conversion Leads under
 * EMPLOYMENT) is unanswered. What removes this: Q-AD40's source, implemented here and injected in
 * `queue/handlers/adsOutcomeFeed.ts` and the tick. The tests inject a dataset on FakeMeta.
 */
export interface OutcomeFeedTarget {
  /** The Conversions API dataset (pixel) id the carrier's lead stages go to. */
  dataset_id: string;
  /** Events Manager's "Test events" code: sandbox certification only (the using-the-api page); never in production. */
  test_event_code?: string;
}

export interface OutcomeFeedTargets {
  /** The target of one Meta connection, or null when the carrier's feed is off (the switch, D-AD14). */
  targetFor(orgId: string, connectionId: string): Promise<OutcomeFeedTarget | null>;
}

/** No carrier has a target until Q-AD40's source exists (header). */
export const NO_FEED_TARGET: OutcomeFeedTargets = { targetFor: async () => null };
