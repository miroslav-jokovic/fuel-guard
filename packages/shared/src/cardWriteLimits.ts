/**
 * Rate limits and daily business caps for EFS card-control writes (plan §6.2). PURE, so the API that
 * enforces them and the web app that explains them read one table and cannot drift.
 *
 * ── Why these are separate from DRIVER_WRITE_LIMITS ──────────────────────────────────────────────
 * The arithmetic is identical and is reused verbatim — the middleware calls `hitWindow` from
 * driverWriteLimits.ts rather than growing a second copy of a fixed-window counter. What differs is
 * everything the numbers MEAN. A driver limit exists so one phone in a retry loop
 * cannot throttle a yard; the failure it guards against is noise. A card limit exists because a write
 * spends money at a pump, and the failure it guards against is a compromised account granting
 * overrides all afternoon. Same shape, opposite risk posture — which is why the two tables are
 * separate values and why the fail-open/fail-closed decision below goes the other way.
 *
 * ── The numbers ──────────────────────────────────────────────────────────────────────────────────
 * Sized against what a real dispatcher does on the worst day of their year, then roughly doubled.
 * Locking cards during a theft sweep is the burst case: ten in a minute is a person working fast,
 * a hundred in a day is a fleet-wide incident that should involve more than one person. Overrides are
 * deliberately tighter than status changes in BOTH dimensions — an override is the only action here
 * that hands out fuel, and five in a minute is already an odd afternoon.
 */

export const CARD_WRITE_BUCKETS = ["card_status", "card_override", "card_prompts"] as const;
export type CardWriteBucket = (typeof CARD_WRITE_BUCKETS)[number];

export interface CardWriteLimit {
  perMinute: number;
  perDay: number;
  /** Used in the operator-facing sentence: "You have reached today's maximum of 25 fuel overrides." */
  label: string;
  /**
   * What to do when the durable counter cannot be reached.
   *
   * `open` — allow the request; the per-minute window still bounds the damage.
   * `closed` — refuse it.
   *
   * DELIBERATE INCONSISTENCY WITH THE DRIVER LIMITER, which always fails open. There, refusing a
   * completed stop because a bookkeeping table is down loses real work that a driver already did.
   * Here, an unmetered `card_override` is unmetered free fuel and an unmetered `card_prompts` can
   * strip the driver-ID prompt off every card in the fleet one call at a time. Status changes stay
   * open because locking a card is the SAFE direction and the 2am theft case must not be blocked by
   * a database hiccup — unlocking is capped by the same bucket, but a card that stays locked for an
   * extra minute is an inconvenience, not a loss.
   */
  onCounterFailure: "open" | "closed";
}

export const CARD_WRITE_LIMITS: Record<CardWriteBucket, CardWriteLimit> = {
  card_status: { perMinute: 10, perDay: 100, label: "card lock changes", onCounterFailure: "open" },
  card_override: { perMinute: 5, perDay: 25, label: "fuel overrides", onCounterFailure: "closed" },
  card_prompts: { perMinute: 10, perDay: 50, label: "prompt changes", onCounterFailure: "closed" },
};

/**
 * Which bucket a request belongs to, or null when it is not a card write at all.
 *
 * Matched on the full pathname rather than the router mount point, so a route cannot escape the
 * limiter by being mounted somewhere unexpected. The cost is that this has to be kept in step with
 * `routes/fuelCards/control.ts`, which is what its test is for — and the route file names this
 * function in a comment so the two are found together.
 */
const PATTERNS: ReadonlyArray<{ bucket: CardWriteBucket; method: "POST" | "DELETE"; re: RegExp }> = [
  { bucket: "card_status", method: "POST", re: /^\/api\/fuel-cards\/[^/]+\/lock\/?$/ },
  { bucket: "card_status", method: "POST", re: /^\/api\/fuel-cards\/[^/]+\/unlock\/?$/ },
  { bucket: "card_override", method: "POST", re: /^\/api\/fuel-cards\/[^/]+\/override\/?$/ },
  // Clearing an override is cheap and safe, but it shares the bucket: a loop of grant/clear/grant
  // would otherwise get twice the budget by alternating.
  { bucket: "card_override", method: "DELETE", re: /^\/api\/fuel-cards\/[^/]+\/override\/?$/ },
  { bucket: "card_prompts", method: "POST", re: /^\/api\/fuel-cards\/[^/]+\/prompts\/?$/ },
];

export function cardWriteBucket(method: string, pathname: string): CardWriteBucket | null {
  const verb = method.toUpperCase();
  if (verb !== "POST" && verb !== "DELETE") return null;
  // Query strings and duplicate slashes must not let a request slip past the match.
  const path = pathname.split("?")[0]!.replace(/\/{2,}/g, "/");
  return PATTERNS.find((p) => p.method === verb && p.re.test(path))?.bucket ?? null;
}

/**
 * The org-wide cap, counted from the mutation ledger rather than from any per-user counter.
 *
 * Per-user limits do not stop three collaborating accounts, and the scenario worth defending against
 * is not one careless dispatcher — it is a credential-stuffed org quietly unlocking a fleet. Default
 * 50/hour is roughly ten times the busiest legitimate hour we can construct.
 */
export const CARD_MUTATIONS_PER_HOUR_DEFAULT = 50;

/** Overrides above this many uses require step-up re-authentication (plan §6.4). Vendor max is 9. */
export const CARD_OVERRIDE_STEP_UP_ABOVE_USES = 3;

/** Too fast. Transient by definition — the window reopens within a minute. */
export const CARD_RATE_LIMITED_CODE = "rate_limited";
/** Today's business maximum. Transient on the scale of hours. */
export const CARD_DAILY_CAP_CODE = "daily_cap_reached";
/** The org's hourly ceiling, across every user. Distinct code: the remedy is a conversation, not a wait. */
export const CARD_ORG_CAP_CODE = "org_hourly_cap_reached";
