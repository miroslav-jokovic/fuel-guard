import { describe, expect, it, vi } from "vitest";
import { ADS_SETTINGS_UNSET, type AdsSettings } from "@silvicom/shared";
import type { MessagesClient } from "../../../../lib/anthropic.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../../../testing/supabaseRecorder.js";
import { runDailyBrief } from "./dailyBrief.js";

/**
 * F1b's job over the real pieces: the stored-hours read, the analyst through the A4 rail, the plain
 * fallback, and the bell (`sendAdsAlert` → `emit_notification`, recipients from the settings or the admins).
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ADMIN = "00000000-0000-4000-8000-0000000000a1";
const NOW = new Date("2026-11-04T13:00:00Z"); // 07:00 Central: the brief for 11/03
const KEY = "ads_brief:2026-11-03";
const on: AdsSettings = { ...ADS_SETTINGS_UNSET, budgets: { ...ADS_SETTINGS_UNSET.budgets, anthropic_tokens_monthly: 1_000_000, agents_enabled: { analyst: true } } };

const CLEAN = { headline: "On 2026-11-03, Night runs spent $25.00 for 2 leads.", points: ["Each lead cost $12.50."] };
const PLANTED = { headline: "On 2026-11-03, Night runs brought 3 leads.", points: ["Each lead cost $12.50."] };

function world(opts: { settings?: AdsSettings; sent?: string[]; hours?: unknown[]; generations?: unknown[] } = {}) {
  return createSupabaseRecorder({
    tables: {
      ads_spend_hourly: opts.hours ?? [{ campaign_id: "c1", hour: "2026-11-03T15:00:00+00:00", spend_cents: 2_500, impressions: 900, clicks: 20, leads: 2 }],
      ads_campaigns: [{ id: "c1", name: "Night runs", connection_id: "k1" }],
      ads_platform_connections: [{ id: "k1", provider: "meta" }],
      ads_settings_versions: [{ id: "v1", org_id: ORG, version: 1, settings: opts.settings ?? on, kill_switch: false, kill_reason: null, created_at: NOW.toISOString(), created_by_name: "X" }],
      ad_generations: (q) => (q.write?.method === "insert" ? [{ id: `gen-${Math.random()}` }] : (opts.generations ?? [])),
      memberships: [{ user_id: ADMIN, role: "admin" }],
      driver_app_features: [],
    },
    rpc: (fn) => (fn === "notification_keys_sent" ? (opts.sent ?? []) : "n-1"),
  });
}

function answering(...outputs: unknown[]) {
  const create = vi.fn(async (_body: unknown) => ({
    id: "msg_1", stop_reason: "tool_use",
    content: [{ type: "tool_use", id: "t1", name: "write_brief", input: outputs[Math.min(create.mock.calls.length - 1, outputs.length - 1)] }],
    usage: { input_tokens: 1500, output_tokens: 250 },
  }));
  return { client: { messages: { create } } as unknown as MessagesClient, create };
}

const bell = (rec: ReturnType<typeof world>) => rec.rpcs().filter((r) => r.fn === "emit_notification").map((r) => r.args as Record<string, unknown>);

describe("the morning brief job (F1b)", () => {
  it("sends the analyst's checked narration to the admins, once, under the day's key", async () => {
    const rec = world();
    const { client, create } = answering(CLEAN);
    const out = await runDailyBrief({ admin: rec.client, client, now: () => NOW }, ORG);
    expect(out).toEqual({ kind: "sent", day: "2026-11-03", by: "analyst", recipients: 1 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(bell(rec)).toEqual([expect.objectContaining({
      p_org: ORG, p_user: ADMIN, p_category: "ads_brief", p_title: CLEAN.headline, p_body: CLEAN.points.join("\n"), p_dedupe_key: KEY, p_entity_id: ORG,
    })]);
    expectOrgScoped(rec, ORG);
  });

  it("a narration refused twice is never sent: the plain figures go instead, after one retry under a new key", async () => {
    const rec = world();
    const { client, create } = answering(PLANTED, PLANTED);
    const out = await runDailyBrief({ admin: rec.client, client, now: () => NOW }, ORG);
    expect(out).toMatchObject({ kind: "sent", by: "plain", why: "refused" });
    expect(create).toHaveBeenCalledTimes(2);
    expect(rec.writtenRows("ad_generations").filter((r) => r.status === "started").map((r) => r.idempotency_key)).toEqual(["brief:2026-11-03:1", "brief:2026-11-03:2"]);
    const [sent] = bell(rec);
    expect(sent!.p_title).toBe("2026-11-03, campaigns that ran: 1. Together: $25.00 spent, 2 leads at $12.50 per lead, 900 impressions, 20 clicks.");
    expect(String(sent!.p_body)).not.toContain("3 leads");
  });

  it("refused once and clean the second time sends the second narration", async () => {
    const rec = world();
    const { client, create } = answering(PLANTED, CLEAN);
    expect(await runDailyBrief({ admin: rec.client, client, now: () => NOW }, ORG)).toMatchObject({ by: "analyst" });
    expect(create).toHaveBeenCalledTimes(2);
    expect(bell(rec)[0]!.p_title).toBe(CLEAN.headline);
  });

  it("with the analyst switched off, the plain figures are sent and no model is asked", async () => {
    const rec = world({ settings: ADS_SETTINGS_UNSET });
    const { client, create } = answering(CLEAN);
    expect(await runDailyBrief({ admin: rec.client, client, now: () => NOW }, ORG)).toMatchObject({ by: "plain", why: "agent_off" });
    expect(create).not.toHaveBeenCalled();
    expect(bell(rec)).toHaveLength(1);
  });

  it("a day already sent stops before any read or model call", async () => {
    const rec = world({ sent: [KEY] });
    const { client, create } = answering(CLEAN);
    expect(await runDailyBrief({ admin: rec.client, client, now: () => NOW }, ORG)).toEqual({ kind: "already_sent", day: "2026-11-03" });
    expect(rec.forTable("ads_spend_hourly")).toHaveLength(0);
    expect(create).not.toHaveBeenCalled();
    expect(bell(rec)).toEqual([]);
  });

  it("a carrier with no spend this month gets no brief", async () => {
    const rec = world({ hours: [] });
    const { client, create } = answering(CLEAN);
    expect(await runDailyBrief({ admin: rec.client, client, now: () => NOW }, ORG)).toEqual({ kind: "nothing_to_report", day: "2026-11-03" });
    expect(create).not.toHaveBeenCalled();
    expect(bell(rec)).toEqual([]);
  });

  it("an analyst call still in flight fails the job and sends nothing, so the next run takes its answer", async () => {
    const rec = world({ generations: [{ id: "g1", status: "started", output: null, error_code: null, started_at: NOW.toISOString(), request: {} }] });
    const { client, create } = answering(CLEAN);
    await expect(runDailyBrief({ admin: rec.client, client, now: () => NOW }, ORG)).rejects.toThrow(/still in flight/);
    expect(create).not.toHaveBeenCalled();
    expect(bell(rec)).toEqual([]);
  });
});
