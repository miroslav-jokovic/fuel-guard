import { CARD_CAPABILITY_KEYS } from "@fuelguard/shared";

/**
 * The `efs_capability_promotions` rows for an org where every capability is approved.
 *
 * ── Why this is DERIVED and not six literals ────────────────────────────────────────────────────
 * A test that hand-lists the promoted keys goes stale the moment a capability is added: the new one
 * has no row, `loadCardControlAccess` correctly refuses it, and the failure surfaces as a rate-limit
 * counter that did not move or a route that answered 403 — never as "you forgot to promote it here".
 * That is precisely the shape `docs/34` warns about, and `check-waiver-growth.mjs` is the standing
 * example of a hand-named list that went stale twice.
 *
 * ── Shape matters, since Step 6.1 ───────────────────────────────────────────────────────────────
 * The gate used to read ONE named capability through `.maybeSingle()`, so a fixture could be a bare
 * `{ state: "enabled" }`. It now reads every capability in one `.in()` query, so the rows carry
 * `capability_key` — and a fixture still returning the bare object silently promotes NOTHING,
 * because no row matches any key. Both of this repo's card-control route suites failed exactly that
 * way when the query changed, which is the reason the shape lives in one place now.
 */
export const promotedCapabilityRows = (
  /**
   * Capabilities to promote beyond the shared registry's own — for suites that mount a synthetic
   * one. `router.test.ts` declares `test_gated` precisely so the ordering assertions do not depend
   * on any real capability's governance, and it still needs a promotion row like anything else.
   */
  ...extraKeys: string[]
): { capability_key: string; state: string }[] =>
  [...CARD_CAPABILITY_KEYS, ...extraKeys].map((capability_key) => ({ capability_key, state: "enabled" }));

/** The table fixture itself, for `createSupabaseRecorder({ tables })`. */
export const promotedCapabilitiesTable = (...extraKeys: string[]) => ({
  data: promotedCapabilityRows(...extraKeys),
  error: null,
});
