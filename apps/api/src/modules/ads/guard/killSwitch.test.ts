import { describe, expect, it } from "vitest";
import { ADS_SETTINGS_UNSET, type AdsSettings } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { saveSettingsVersion, settingsInForce } from "../settings/settingsVersions.js";
import { recordApproval } from "./approvals.js";
import { setKillSwitch } from "./killSwitch.js";

const ORG = "org-a";
const ACTOR = { id: "11111111-1111-4111-8111-111111111111", name: "Owner" };
const NOW = new Date("2026-11-15T18:00:00Z");
const CAPPED: AdsSettings = { ...ADS_SETTINGS_UNSET, limits: { ...ADS_SETTINGS_UNSET.limits, daily_max_cents: 9_000 } };

function db(opts: { current?: { kill_switch: boolean; kill_reason: string | null; settings?: AdsSettings } | null; insertError?: unknown } = {}) {
  const current = opts.current === undefined ? { kill_switch: false, kill_reason: null } : opts.current;
  return createSupabaseRecorder({
    tables: {
      ads_settings_versions: (q) => {
        if (q.write) return opts.insertError ? { data: null, error: opts.insertError, writeError: opts.insertError } : [{ id: "v-new", version: 8 }];
        return current ? [{ id: "v7", version: 7, settings: current.settings ?? CAPPED, created_at: "2026-11-01T00:00:00Z", created_by_name: "Owner", ...current }] : [];
      },
      ads_actions: [{ id: "act-1" }],
      ads_campaigns: [{ id: "camp-1" }],
      ads_approvals: (q) => (q.write ? [{ id: "appr-9" }] : [{ id: "appr-1", kind: "launch" }]),
    },
  });
}
const versions = (rec: ReturnType<typeof db>) => rec.writtenRows("ads_settings_versions");

describe("saveSettingsVersion — a save carries what it does not change", () => {
  it("saving caps while the kill switch is on keeps it on, with its reason", async () => {
    const rec = db({ current: { kill_switch: true, kill_reason: "overspend" } });
    await saveSettingsVersion(rec.client, ORG, ACTOR, { settings: ADS_SETTINGS_UNSET });
    expect(versions(rec)).toEqual([expect.objectContaining({ version: 8, kill_switch: true, kill_reason: "overspend", settings: ADS_SETTINGS_UNSET })]);
  });

  it("pressing the switch keeps the settings it found", async () => {
    const rec = db();
    await setKillSwitch(rec.client, ORG, ACTOR, true, "audit", NOW);
    expect(versions(rec)[0]).toMatchObject({ settings: CAPPED, kill_switch: true, kill_reason: "audit" });
  });

  it("the first save is version 1", async () => {
    const rec = db({ current: null });
    await saveSettingsVersion(rec.client, ORG, ACTOR, { settings: CAPPED });
    expect(versions(rec)[0]).toMatchObject({ version: 1, kill_switch: false, kill_reason: null });
  });

  it("two saves at once: the second is a conflict, not a silent overwrite", async () => {
    const rec = db({ insertError: { code: "23505", message: "duplicate key" } });
    expect(await saveSettingsVersion(rec.client, ORG, ACTOR, { settings: CAPPED })).toBe("conflict");
  });

  it("a stored version that no longer parses is a fault, not 'everything off'", async () => {
    const rec = db({ current: { kill_switch: false, kill_reason: null, settings: { limits: "broken" } as never } });
    await expect(settingsInForce(rec.client, ORG)).rejects.toThrow(/do not parse/);
  });
});

describe("setKillSwitch", () => {
  it("pressing writes a version and a kill row with the reason; clearing records the reason too", async () => {
    const on = db();
    expect(await setKillSwitch(on.client, ORG, ACTOR, true, "spend looks wrong", NOW)).toEqual({ kind: "changed", version: 8 });
    expect(on.writtenRows("ads_actions")).toEqual([expect.objectContaining({ kind: "kill", status: "succeeded", cause: "spend looks wrong", actor_id: ACTOR.id })]);

    const off = db({ current: { kill_switch: true, kill_reason: "spend looks wrong" } });
    await setKillSwitch(off.client, ORG, ACTOR, false, "checked with Meta", NOW);
    expect(versions(off)[0]).toMatchObject({ kill_switch: false, kill_reason: null });
    expect(off.writtenRows("ads_actions")[0]).toMatchObject({ kind: "kill", cause: "cleared: checked with Meta" });
    expectOrgScoped(off, ORG);
  });

  it("pressing an already-pressed switch writes nothing, so the first reason is not buried", async () => {
    const rec = db({ current: { kill_switch: true, kill_reason: "first" } });
    expect(await setKillSwitch(rec.client, ORG, ACTOR, true, "second", NOW)).toEqual({ kind: "unchanged", kill_switch: true });
    expect(rec.writes()).toEqual([]);
  });
});

describe("recordApproval", () => {
  it("records the amounts and the settings version in force", async () => {
    const rec = db();
    expect(await recordApproval(rec.client, ORG, ACTOR, "camp-1", { kind: "launch", daily_budget_cents: 5_000, lifetime_cap_cents: 50_000 })).toEqual({ ok: true, id: "appr-9" });
    expect(rec.writtenRows("ads_approvals")).toEqual([
      expect.objectContaining({ org_id: ORG, campaign_id: "camp-1", kind: "launch", daily_budget_cents: 5_000, lifetime_cap_cents: 50_000, settings_version_id: "v7", approved_by: ACTOR.id, withdraws_id: null }),
    ]);
    expectOrgScoped(rec, ORG);
  });

  it("refuses before any limits are saved", async () => {
    const rec = db({ current: null });
    expect(await recordApproval(rec.client, ORG, ACTOR, "camp-1", { kind: "launch", daily_budget_cents: 5_000, lifetime_cap_cents: 50_000 })).toEqual({ ok: false, refusal: "settings_not_saved" });
    expect(rec.writes()).toEqual([]);
  });

  it("a withdrawal is a new row naming the approval; withdrawing a withdrawal is refused", async () => {
    const rec = db();
    await recordApproval(rec.client, ORG, ACTOR, "camp-1", { kind: "withdraw", withdraws_id: "22222222-2222-4222-8222-222222222222", reason: "wrong budget" });
    expect(rec.writtenRows("ads_approvals")[0]).toMatchObject({ kind: "withdraw", withdraws_id: "22222222-2222-4222-8222-222222222222", daily_budget_cents: null });

    const w = createSupabaseRecorder({
      tables: {
        ads_campaigns: [{ id: "camp-1" }],
        ads_settings_versions: [{ id: "v7", version: 7, settings: CAPPED, kill_switch: false, kill_reason: null, created_at: "x", created_by_name: "O" }],
        ads_approvals: [{ id: "w-1", kind: "withdraw" }],
      },
    });
    expect(await recordApproval(w.client, ORG, ACTOR, "camp-1", { kind: "withdraw", withdraws_id: "22222222-2222-4222-8222-222222222222", reason: "x" })).toEqual({ ok: false, refusal: "nothing_to_withdraw" });
  });
});
