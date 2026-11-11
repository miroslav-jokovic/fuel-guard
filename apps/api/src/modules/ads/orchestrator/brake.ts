import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../../env.js";
import { settingsInForce } from "../settings/settingsVersions.js";
import type { CampaignWorkers } from "./workers.js";

/**
 * The orchestrator's brake: when it must stop delivery whatever an org's own kill switch says
 * (2026-11-03 audit, findings M3 and M4). Both the tick and the runner read it, so the tick cannot
 * enqueue a step the runner would refuse, or skip one the runner would take.
 *
 * ⚠ `ADS_ENABLED=false` IS A BRAKE, NOT AN OFF SWITCH. Before this file it stopped the tick outright,
 * and with the tick went the kill switch's second half: an operator turning the flag off in an
 * emergency left every live ad delivering, with nothing of ours able to pause it. Now the flag off
 * means "the agent does nothing but pause": every org is read as killed, only the platform worker is
 * kept, so launching and live go to `pausing` and pausing reaches the platform. On a host with no
 * campaign that can deliver (production until Stage 2) that is one empty read a minute.
 *
 * ⚠ SETTINGS THAT CANNOT BE READ ARE READ AS KILLED. `settingsInForce` throws on an unparseable row;
 * in the tick, that throw used to abort the whole pass, so one org's bad row stopped every other
 * org's kill-switch pauses. Failing toward the pause is the same direction as every other fence here.
 */
export const ADS_DISABLED_BRAKE = "ADS_ENABLED is off";

export function brakeFor(env: Pick<Env, "ADS_ENABLED">): string | null {
  return env.ADS_ENABLED ? null : ADS_DISABLED_BRAKE;
}

/** Under a brake the agent only stops things: no compose, no create, the platform kept for the pause. */
export function brakeWorkers(workers: CampaignWorkers): CampaignWorkers {
  return { compose: null, createPaused: null, platform: workers.platform, refresh: null };
}

/** Why this org's delivery must stop now, or null. A brake wins; unreadable settings stop too. */
export async function killReason(admin: SupabaseClient, orgId: string, brake: string | null): Promise<string | null> {
  if (brake) return brake;
  try {
    const inForce = await settingsInForce(admin, orgId);
    return inForce.kill_switch ? (inForce.kill_reason ?? "kill switch on") : null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ads-orchestrator] org ${orgId}: settings unreadable, treated as killed — ${message}`);
    return `settings unreadable: ${message}`;
  }
}
