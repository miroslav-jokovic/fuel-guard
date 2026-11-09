import type { AdArea, AdPlatform } from "@silvicom/shared";

/**
 * What every platform adapter (Meta first, B1–B5; TikTok, X, the simulator later) offers, split in
 * two ON PURPOSE (ADS-AGENT-PLAN §2c, "Budget guard: be bypassed — it is the only path to an
 * adapter's spend calls").
 *
 *   · `PlatformSafe` — what the agent may do alone (plan §5): create paused, pause, lower, read.
 *   · `PlatformSpend` — what moves more money or reaches more people: launch, raise, widen the area.
 *
 * `PlatformSpend` is reached ONLY through `guard/budgetGuard.ts`. An adapter exposes it from a
 * factory the guard is handed; no other file may name the type or call its methods.
 * `budgetGuard.boundary.test.ts` reads every non-test source file under apps/api/src and fails on
 * either, outside `modules/ads/guard/` and `modules/ads/platforms/`. The type is the fence's handle:
 * a caller that cannot name `PlatformSpend` cannot be handed one without the boundary test seeing it.
 */

/** The campaign as an adapter needs it: our id and the platform's ids we recorded for it. */
export interface PlatformCampaignRef {
  campaign_id: string;
  platform: AdPlatform;
  platform_refs: Record<string, unknown>;
}

export type PlatformOutcome =
  | { ok: true; platform_refs?: Record<string, unknown>; response?: unknown }
  /** `error_code` is the platform's, normalised by the adapter (e.g. `meta_2703`, `rate_limited`). */
  | { ok: false; error_code: string; response?: unknown };

/**
 * The one failure an adapter returns WITHOUT having written anything: the campaign has no platform ids
 * recorded, so there is nothing on the platform to activate — or to pause. The runner reads it to tell
 * a launch that never left us from one that failed part-way at the platform (2026-11-03 audit H1).
 */
export const NOT_ON_PLATFORM = "no_platform_ref";

export interface SpendCall {
  campaign: PlatformCampaignRef;
  daily_budget_cents: number;
  lifetime_cap_cents: number;
  /** Sent to the platform where it takes one, so a retried call cannot act twice there either. */
  idempotency_key: string;
}

export interface PlatformSpend {
  launch(call: SpendCall): Promise<PlatformOutcome>;
  raiseDailyBudget(call: SpendCall): Promise<PlatformOutcome>;
  changeArea(call: { campaign: PlatformCampaignRef; area: AdArea; idempotency_key: string }): Promise<PlatformOutcome>;
}

export interface PlatformSafe {
  /**
   * What the ad account's own spending limit still lets it spend, as the platform reports it NOW (D-AD3
   * fence 3): the limit less what the account has already spent; 0 when the limit is reached; null when
   * there is no limit or it cannot be read. Read before every launch and raise rather than from a stored
   * copy: the owner changes the limit by hand in the platform, and a stale copy is the fence that lies.
   *
   * ⚠ HEADROOM, NOT THE LIMIT (2026-11-03 audit M1). Meta's account `spend_cap` is a LIFETIME total. Read
   * raw, an account that had spent $50k needed a cap above $50k to deliver anything — so it was refused
   * forever as "above our monthly cap" — and an account a few dollars from its cap looked roomy.
   */
  readAccountHeadroomCents(): Promise<number | null>;
  /**
   * What the ad account has spent from `since` to `until` (days, inclusive), as the platform reports it
   * NOW, in cents; null when unreadable (2026-11-03 audit H4). The guard's month-to-date until B5's
   * monitor writes `ads_spend_hourly` — and after, the check on it: it counts spend made in the
   * platform's own tool on the same account, which our rows never see.
   */
  readSpendCents(range: { since: string; until: string }): Promise<number | null>;
  /**
   * Stop delivery (A6, 2026-11-02): the orchestrator's `pausing` step, and so the kill switch's second
   * half — the switch stops new spending at once (AX021), this stops what is already delivering. The
   * safe direction, so no guard and no approval; idempotent at the platform (pausing a paused
   * campaign is a success), which is what lets a step that crashed mid-call simply ask again.
   */
  pause(call: { campaign: PlatformCampaignRef; idempotency_key: string }): Promise<PlatformOutcome>;
  /**
   * Stop ONE ad's delivery while its campaign keeps running (CQ9, D-AD23): a tired ad is retired, the next concept
   * enters. The safe direction, like `pause`: no guard, no approval, idempotent at the platform. `ad` is the
   * platform's own id for the ad, as the publisher recorded it (`platform_refs.ads[].meta_ad_id`).
   */
  pauseAd(call: { campaign: PlatformCampaignRef; ad: string; idempotency_key: string }): Promise<PlatformOutcome>;
}

/** One connection's adapter, both halves. Built by B1's registry; the orchestrator never sees it whole. */
export interface PlatformAdapter {
  safe: PlatformSafe;
  spend: PlatformSpend;
}
