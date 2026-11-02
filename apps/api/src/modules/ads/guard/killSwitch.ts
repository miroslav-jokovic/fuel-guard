import type { SupabaseClient } from "@supabase/supabase-js";
import { recordFinished } from "../actions/actionLedger.js";
import { saveSettingsVersion, settingsInForce, type Actor } from "../settings/settingsVersions.js";

/**
 * The kill switch (D-AD3; plan §4b "one button, with the reason required"). It is a column of the
 * newest settings version, so pressing or clearing it is a new version, with its actor and reason, and
 * the database refuses a launch or raise while it is on (AX021) whatever code asks.
 *
 * Who: pressing it only stops spending — the safe direction, open to anyone who manages the brief's
 * section (`ADS_AUTHORITY.kill_switch_on`). Clearing it lets spending start again, so it is `ads.spend`
 * with a fresh sign-in (`kill_switch_off`). Both doors are in `routes/guard.ts`.
 *
 * Each flip also writes one `ads_actions` row of kind `kill`, because the money audit trail is where
 * somebody reading "why did every ad stop at 14:02" looks. Pausing what is live is the orchestrator's
 * reaction to that state (A6): this file stops new spending at once; A6 pauses delivery.
 *
 * Pressing an already-pressed switch writes nothing and says so: a second version identical to the
 * first would bury the reason the first person gave.
 */

export type KillSwitchResult =
  | { kind: "changed"; version: number }
  | { kind: "unchanged"; kill_switch: boolean }
  | { kind: "conflict" };

export async function setKillSwitch(
  admin: SupabaseClient,
  orgId: string,
  actor: Actor,
  on: boolean,
  reason: string,
  now: Date,
): Promise<KillSwitchResult> {
  const current = await settingsInForce(admin, orgId);
  if (current.kill_switch === on) return { kind: "unchanged", kill_switch: on };
  const saved = await saveSettingsVersion(admin, orgId, actor, on ? { kill_switch: true, kill_reason: reason } : { kill_switch: false });
  if (saved === "conflict") return { kind: "conflict" };
  await recordFinished(
    admin,
    {
      org_id: orgId,
      campaign_id: null,
      kind: "kill",
      actor_kind: "person",
      actor_id: actor.id,
      actor_name: actor.name,
      cause: on ? reason : `cleared: ${reason}`,
      request: { kill_switch: on, settings_version: saved.version },
    },
    { status: "succeeded", at: now.toISOString() },
  );
  return { kind: "changed", version: saved.version };
}
