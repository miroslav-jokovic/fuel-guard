import { describe, expect, it } from "vitest";
import { INVITE_TTL_DAYS_DEFAULT, STALE_DRAFT_HOURS } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { recruitingSettings, recruitingSettingsView, saveRecruitingSettings } from "./recruitingSettings.js";

/**
 * The carrier's link lifetime and reminder (Q-AW41, S2). The fixture is a function holding one row, so
 * the UPDATE-then-INSERT path is driven by the state it meets rather than by a scripted order.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const USER = "99999999-8888-4777-8666-555555555555";
const STAMP = "2026-09-28T12:00:00.000Z";

function table(opts: { row?: Record<string, unknown> | null; readError?: unknown; insertRace?: boolean } = {}) {
  let row = opts.row ?? null;
  let raced = false;
  return (q: RecordedQuery) => {
    if (!q.write) return opts.readError ? { error: opts.readError } : row ? [row] : [];
    const payload = q.write.payload as Record<string, unknown>;
    if (q.write.method === "update") {
      if (!row) return [];
      row = { ...row, ...payload, updated_at: STAMP };
      return [row];
    }
    if (q.write.method === "insert") {
      if (opts.insertRace && !raced) {
        // Another save created the row between our UPDATE and this INSERT.
        raced = true;
        row = { invite_ttl_days: 30, reminders_enabled: true, reminder_after_hours: 72, updated_at: STAMP };
        return { writeError: { code: "23505", message: "duplicate key" } };
      }
      row = { ...payload, updated_at: STAMP };
      return [row];
    }
    return [];
  };
}

const saved = { invite_ttl_days: 5, reminders_enabled: false, reminder_after_hours: 200, handbook_blocks_hire: true, videos_block_hire: true };
/** What a screen served before §9 P12 PUTs: the three link answers, no hire switch. */
const { handbook_blocks_hire: _omitted, videos_block_hire: _omittedToo, ...oldScreen } = saved;
/** What a screen served before HW8a PUTs: the handbook switch, not the videos'. */
const { videos_block_hire: _notYet, ...p12Screen } = saved;

describe("reading what is in force", () => {
  it("is the shared constants while the carrier has no row", async () => {
    const rec = createSupabaseRecorder({ tables: { recruiting_settings: table() } });
    expect(await recruitingSettings(rec.client, ORG)).toEqual({
      invite_ttl_days: INVITE_TTL_DAYS_DEFAULT,
      reminders_enabled: true,
      reminder_after_hours: STALE_DRAFT_HOURS,
      handbook_blocks_hire: false,
      videos_block_hire: false,
    });
    expect(await recruitingSettingsView(rec.client, ORG)).toMatchObject({ isDefault: true, updatedAt: null });
    expectOrgScoped(rec, ORG);
  });

  it("is the carrier's row once it has one, and says so", async () => {
    const rec = createSupabaseRecorder({ tables: { recruiting_settings: table({ row: { ...saved, updated_at: STAMP } }) } });
    expect(await recruitingSettings(rec.client, ORG)).toEqual(saved);
    expect(await recruitingSettingsView(rec.client, ORG)).toEqual({ settings: saved, isDefault: false, updatedAt: STAMP });
  });

  it("throws on a failed read rather than falling back to a longer-lived default", async () => {
    const rec = createSupabaseRecorder({ tables: { recruiting_settings: table({ readError: { message: "boom" } }) } });
    await expect(recruitingSettings(rec.client, ORG)).rejects.toThrow("Could not read the recruiting settings");
  });
});

describe("saving", () => {
  it("inserts the org's row, all three answers and who, when there is none", async () => {
    const rec = createSupabaseRecorder({ tables: { recruiting_settings: table() } });
    const out = await saveRecruitingSettings(rec.client, ORG, USER, saved);
    expect(rec.writes().map((w) => w.write!.method)).toEqual(["update", "insert"]);
    expect(rec.writtenRows("recruiting_settings").at(-1)).toEqual({ org_id: ORG, ...saved, updated_by: USER });
    expect(out.view).toEqual({ settings: saved, isDefault: false, updatedAt: STAMP });
    expect(out.before).toMatchObject({ invite_ttl_days: INVITE_TTL_DAYS_DEFAULT });
    expectOrgScoped(rec, ORG);
  });

  it("updates the existing row and never inserts a second", async () => {
    const rec = createSupabaseRecorder({
      tables: { recruiting_settings: table({ row: { invite_ttl_days: 14, reminders_enabled: true, reminder_after_hours: 48, updated_at: "x" } }) },
    });
    const out = await saveRecruitingSettings(rec.client, ORG, USER, saved);
    expect(rec.writes().map((w) => w.write!.method)).toEqual(["update"]);
    expect(rec.writtenRows("recruiting_settings")).toEqual([{ ...saved, updated_by: USER }]);
    expect(out.before).toEqual({ invite_ttl_days: 14, reminders_enabled: true, reminder_after_hours: 48 });
    expect(out.view.settings).toEqual(saved);
    expectOrgScoped(rec, ORG);
  });

  it("answers a racing save's duplicate key by updating the row it made", async () => {
    const rec = createSupabaseRecorder({ tables: { recruiting_settings: table({ insertRace: true }) } });
    const out = await saveRecruitingSettings(rec.client, ORG, USER, saved);
    expect(rec.writes().map((w) => w.write!.method)).toEqual(["update", "insert", "update"]);
    expect(out.view.settings).toEqual(saved);
  });

  it("§9 P12: a save without the hire switch keeps the switch in force rather than turning it off", async () => {
    const rec = createSupabaseRecorder({
      tables: { recruiting_settings: table({ row: { invite_ttl_days: 14, reminders_enabled: true, reminder_after_hours: 48, handbook_blocks_hire: true, updated_at: "x" } }) },
    });
    const out = await saveRecruitingSettings(rec.client, ORG, USER, oldScreen);
    expect(rec.writtenRows("recruiting_settings")).toEqual([{ ...oldScreen, handbook_blocks_hire: true, updated_by: USER }]);
    expect(out.view.settings.handbook_blocks_hire).toBe(true);
  });

  it("HW8a: a save from a screen without the videos switch keeps it in force", async () => {
    const rec = createSupabaseRecorder({
      tables: { recruiting_settings: table({ row: { invite_ttl_days: 14, reminders_enabled: true, reminder_after_hours: 48, handbook_blocks_hire: false, videos_block_hire: true, updated_at: "x" } }) },
    });
    const out = await saveRecruitingSettings(rec.client, ORG, USER, p12Screen);
    expect(rec.writtenRows("recruiting_settings")).toEqual([{ ...p12Screen, videos_block_hire: true, updated_by: USER }]);
    expect(out.view.settings.videos_block_hire).toBe(true);
  });

  it("§9 P12: a first save without the hire switch writes the default, off", async () => {
    const rec = createSupabaseRecorder({ tables: { recruiting_settings: table() } });
    await saveRecruitingSettings(rec.client, ORG, USER, oldScreen);
    expect(rec.writtenRows("recruiting_settings").at(-1)).toMatchObject({ handbook_blocks_hire: false, videos_block_hire: false });
  });

  it("never writes with upsert", async () => {
    const rec = createSupabaseRecorder({ tables: { recruiting_settings: table() } });
    await saveRecruitingSettings(rec.client, ORG, USER, saved);
    expect(rec.writes().some((w) => w.write!.method === "upsert")).toBe(false);
  });
});
