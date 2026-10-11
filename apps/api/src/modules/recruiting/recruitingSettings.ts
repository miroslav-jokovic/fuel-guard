import type { SupabaseClient } from "@supabase/supabase-js";
import {
  RECRUITING_SETTINGS_DEFAULTS,
  type RecruitingSettings,
  type RecruitingSettingsView,
} from "@silvicom/shared";

/**
 * The carrier's link lifetime and reminder (APPLICATION-FLOW-V2-PLAN.md S2, Q-AW41; the table is 0379).
 *
 * ── THE ONE READER ────────────────────────────────────────────────────────────────────────────
 * Every place that extends a link or decides a reminder asks `recruitingSettings` — the invite, "send the
 * link again", Send, open signing, the handbook's Open/Extend, and the reminder sweep — so none of them
 * restates 14 or 48. No row is the product's defaults (`RECRUITING_SETTINGS_DEFAULTS`, built from the
 * shared constants), which is every org until it first saves.
 *
 * ⚠ A READ ERROR IS NOT "NO ROW". A failed read that fell back to the defaults would quietly give a
 * carrier who chose a 3-day link a 14-day one — longer-lived credentials than they asked for — so it
 * throws, and the caller's own error path answers.
 *
 * ── THE WRITE: ALL THREE ANSWERS, UPDATE THEN INSERT ──────────────────────────────────────────
 * Never `.upsert()` (lint:upserts): the save is an UPDATE of the org's row, and an INSERT when there was
 * none. Two saves racing to create the row meet 0379's primary key; the loser's 23505 is answered by
 * updating the row the winner made, so the later press is the one that stands, as it would have been.
 */
const COLS = "invite_ttl_days, reminders_enabled, reminder_after_hours, updated_at";

type Row = RecruitingSettings & { updated_at: string };

async function readRow(admin: SupabaseClient, orgId: string): Promise<Row | null> {
  const { data, error } = await admin
    .from("recruiting_settings")
    .select(COLS)
    // The service role bypasses RLS; this query carries its own tenant scope.
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the recruiting settings: ${error.message}`);
  return (data as Row | null) ?? null;
}

const pick = (r: RecruitingSettings): RecruitingSettings => ({
  invite_ttl_days: r.invite_ttl_days,
  reminders_enabled: r.reminders_enabled,
  reminder_after_hours: r.reminder_after_hours,
});

/** What is in force for this org: its row, else the product's defaults. Throws on a failed read. */
export async function recruitingSettings(admin: SupabaseClient, orgId: string): Promise<RecruitingSettings> {
  const row = await readRow(admin, orgId);
  return row ? pick(row) : { ...RECRUITING_SETTINGS_DEFAULTS };
}

/** The same, for the settings screen: whether the carrier has chosen, and when. */
export async function recruitingSettingsView(admin: SupabaseClient, orgId: string): Promise<RecruitingSettingsView> {
  const row = await readRow(admin, orgId);
  return row
    ? { settings: pick(row), isDefault: false, updatedAt: row.updated_at }
    : { settings: { ...RECRUITING_SETTINGS_DEFAULTS }, isDefault: true, updatedAt: null };
}

export interface RecruitingSettingsSaved {
  view: RecruitingSettingsView;
  /** What was in force before the save — the audit's "from". */
  before: RecruitingSettings;
}

/** Writes all three answers. The input is the contract's, already validated (bounds and the refine). */
export async function saveRecruitingSettings(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  input: RecruitingSettings,
): Promise<RecruitingSettingsSaved> {
  const before = await recruitingSettings(admin, orgId);
  const answers = { ...pick(input), updated_by: userId };

  const update = () =>
    admin.from("recruiting_settings").update(answers).eq("org_id", orgId).select(COLS);

  let { data, error } = await update();
  if (!error && (data ?? []).length === 0) {
    const inserted = await admin.from("recruiting_settings").insert({ org_id: orgId, ...answers }).select(COLS);
    ({ data, error } = inserted);
    // Another save created the row between our UPDATE and INSERT: update the row it made.
    if (error?.code === "23505") ({ data, error } = await update());
  }
  if (error) throw new Error(`Could not save the recruiting settings: ${error.message}`);
  const row = ((data ?? []) as Row[])[0];
  if (!row) throw new Error("Could not save the recruiting settings: no row was written.");
  return { view: { settings: pick(row), isDefault: false, updatedAt: row.updated_at }, before };
}
