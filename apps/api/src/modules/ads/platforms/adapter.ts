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
   * The ad account's own spending limit as the platform reports it NOW (D-AD3 fence 3), or null when
   * it is unset or unreadable. Read before every launch and raise rather than from a stored copy: the
   * owner changes it by hand in the platform, and a stale copy is the one fence that would lie.
   */
  readAccountLimitCents(): Promise<number | null>;
  /**
   * Stop delivery (A6, 2026-11-02): the orchestrator's `pausing` step, and so the kill switch's second
   * half — the switch stops new spending at once (AX021), this stops what is already delivering. The
   * safe direction, so no guard and no approval; idempotent at the platform (pausing a paused
   * campaign is a success), which is what lets a step that crashed mid-call simply ask again.
   */
  pause(call: { campaign: PlatformCampaignRef; idempotency_key: string }): Promise<PlatformOutcome>;
}

/** One connection's adapter, both halves. Built by B1's registry; the orchestrator never sees it whole. */
export interface PlatformAdapter {
  safe: PlatformSafe;
  spend: PlatformSpend;
}
