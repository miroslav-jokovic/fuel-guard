import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdPlatform } from "@silvicom/shared";
import type { PlatformAdapter, PlatformSafe } from "../platforms/adapter.js";
import { guardedSpend, type GuardActor, type GuardOutcome } from "./budgetGuard.js";

/**
 * A platform as the orchestrator may hold it (A6, 2026-11-02): the safe half as it is, and a launch
 * that can only happen through `guardedSpend`. The spend half is closed over HERE, inside `guard/`,
 * so the orchestrator holds a function that runs every fence rather than an object it could call
 * `.launch(` on — `budgetGuard.boundary.test.ts` keeps it that way for every file outside `guard/`
 * and `platforms/`. Named `guardedLaunch`, not `launch`, because that scan reads text: a call it
 * cannot tell from an adapter's would be one more thing to explain away (it flagged the first draft).
 *
 * Raise and area change are not offered: no unattended step raises a budget or widens an area (plan
 * §5 — a person does both, through the A5 doors), so the runner is not handed a way to.
 */
export interface GuardedPlatform {
  platform: AdPlatform;
  safe: PlatformSafe;
  guardedLaunch(ask: { orgId: string; campaignId: string; daily_cents: number; lifetime_cents: number; actor: GuardActor }): Promise<GuardOutcome>;
}

export function guardPlatform(admin: SupabaseClient, now: () => Date, platform: AdPlatform, adapter: PlatformAdapter): GuardedPlatform {
  return {
    platform,
    safe: adapter.safe,
    guardedLaunch: (ask) => guardedSpend({ admin, now, safe: adapter.safe, spend: adapter.spend }, { ...ask, act: "launch" }),
  };
}
