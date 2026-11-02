import type { SupabaseClient } from "@supabase/supabase-js";
import { ADS_SETTINGS_UNSET, adsSettingsSchema, type AdsSettings } from "@silvicom/shared";

/**
 * `ads_settings_versions` (0537): every save of Settings › Ads control is a new row, the newest per org
 * is in force, kill switch included, and no row is ever changed (AX012). This file is the only place
 * the ads module reads or writes that table.
 *
 * No row yet = `ADS_SETTINGS_UNSET`: every agent off, every amount null, so everything that spends
 * refuses — the settings contract's "not set refuses", not a default somebody picked.
 *
 * A stored version that no longer parses THROWS rather than falling back to UNSET. The save validates
 * before it writes, so an unparseable row is a bug or a hand edit; a silent fallback would hide it
 * behind "the agents are off", which looks like a setting, not like a fault. It is still fail-closed:
 * nothing runs on a settings row nobody can read.
 *
 * ── A SAVE CARRIES WHAT IT DOES NOT CHANGE ───────────────────────────────────────────────────────
 * A row holds the settings AND the kill switch, so a settings save copies the switch it found and a
 * switch press copies the settings it found. Otherwise saving a cap while the switch was on would
 * quietly switch spending back on — the act `ads.spend` exists to make deliberate.
 *
 * Two saves at once both read version n and both write n + 1: `unique (org_id, version)` refuses the
 * second (23505), returned as `"conflict"`, never retried here. A retry would apply this caller's
 * change on top of a version they never saw — the page reloads and they decide again.
 */

export interface SettingsInForce {
  settings: AdsSettings;
  /** Null when the org has never saved (the UNSET defaults). */
  version_id: string | null;
  version: number | null;
  kill_switch: boolean;
  kill_reason: string | null;
  created_at: string | null;
  created_by_name: string | null;
}

const COLUMNS = "id, version, settings, kill_switch, kill_reason, created_at, created_by_name";

interface VersionRow {
  id: string;
  version: number;
  settings: unknown;
  kill_switch: boolean;
  kill_reason: string | null;
  created_at: string;
  created_by_name: string;
}

export async function settingsInForce(admin: SupabaseClient, orgId: string): Promise<SettingsInForce> {
  const { data, error } = await admin
    .from("ads_settings_versions")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`ads_settings_versions: ${error.message}`);
  const row = data as VersionRow | null;
  if (!row) {
    return { settings: ADS_SETTINGS_UNSET, version_id: null, version: null, kill_switch: false, kill_reason: null, created_at: null, created_by_name: null };
  }
  const parsed = adsSettingsSchema.safeParse(row.settings);
  if (!parsed.success) throw new Error(`ads_settings_versions ${row.id}: stored settings do not parse (${parsed.error.issues[0]?.message ?? "invalid"})`);
  return {
    settings: parsed.data,
    version_id: row.id,
    version: row.version,
    kill_switch: row.kill_switch,
    kill_reason: row.kill_reason,
    created_at: row.created_at,
    created_by_name: row.created_by_name,
  };
}

export interface Actor {
  id: string;
  name: string;
}

/** What one save changes; whatever is absent is carried from the version in force. */
export type SettingsChange =
  | { settings: AdsSettings }
  | { kill_switch: true; kill_reason: string }
  | { kill_switch: false };

export async function saveSettingsVersion(
  admin: SupabaseClient,
  orgId: string,
  actor: Actor,
  change: SettingsChange,
): Promise<{ id: string; version: number } | "conflict"> {
  const current = await settingsInForce(admin, orgId);
  const settings = "settings" in change ? adsSettingsSchema.parse(change.settings) : current.settings;
  const kill = "kill_switch" in change ? change.kill_switch : current.kill_switch;
  const killReason = "kill_switch" in change ? (change.kill_switch ? change.kill_reason : null) : current.kill_reason;
  const version = (current.version ?? 0) + 1;
  const { data, error } = await admin
    .from("ads_settings_versions")
    .insert({
      org_id: orgId,
      version,
      settings,
      kill_switch: kill,
      kill_reason: killReason,
      created_by: actor.id,
      created_by_name: actor.name,
    })
    .select("id, version")
    .single();
  if (error) {
    if ((error as { code?: string }).code === "23505") return "conflict";
    throw new Error(`ads_settings_versions insert: ${error.message}`);
  }
  return data as { id: string; version: number };
}
