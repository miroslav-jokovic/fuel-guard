import type { SupabaseClient } from "@supabase/supabase-js";
import { ADS_SETTINGS_UNSET, adsSettingsSchema, type AdsSettings } from "@silvicom/shared";

/**
 * The settings in force for an org: the newest `ads_settings_versions` row (0537; every save is a new
 * version, the newest wins, kill switch included). This is the READ side, written for the AI rail's
 * gate (A4); A5 adds the save behind the settings route, next to it, so read and write share a folder.
 *
 * No row yet = `ADS_SETTINGS_UNSET`: every agent off, every amount null, so everything that spends
 * refuses — the settings contract's "not set refuses", not a default somebody picked.
 *
 * A stored version that no longer parses THROWS rather than falling back to UNSET. The save validates
 * before it writes, so an unparseable row is a bug or a hand edit; a silent fallback would hide it
 * behind "the agents are off", which looks like a setting, not like a fault. Throwing fails the job
 * that asked, which is visible on the failed-jobs page (E5) — and it is still fail-closed: nothing
 * runs on a settings row nobody can read.
 */
export interface SettingsInForce {
  settings: AdsSettings;
  /** Null when the org has never saved (the UNSET defaults). */
  version_id: string | null;
  kill_switch: boolean;
}

export async function settingsInForce(admin: SupabaseClient, orgId: string): Promise<SettingsInForce> {
  const { data, error } = await admin
    .from("ads_settings_versions")
    .select("id, settings, kill_switch")
    .eq("org_id", orgId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`ads_settings_versions: ${error.message}`);
  const row = data as { id: string; settings: unknown; kill_switch: boolean } | null;
  if (!row) return { settings: ADS_SETTINGS_UNSET, version_id: null, kill_switch: false };
  const parsed = adsSettingsSchema.safeParse(row.settings);
  if (!parsed.success) throw new Error(`ads_settings_versions ${row.id}: stored settings do not parse (${parsed.error.issues[0]?.message ?? "invalid"})`);
  return { settings: parsed.data, version_id: row.id, kill_switch: row.kill_switch };
}
