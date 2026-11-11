import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADS_SETTINGS_UNSET, type AdsSettings, type LeadQualityCounts } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { checkLeadQuality, leadQualityDedupeKey } from "./leadQualityCheck.js";

/**
 * LQ3b (Q-AD51 (a)): the lead-quality alert, over a stubbed `LeadQuality` (recruiting's reader has its own test,
 * `recruiting/leads/leadQuality.test.ts`) and a stubbed bell (`sendAdsAlert`'s audience is `adsAlerts.test.ts`').
 */
const holder = vi.hoisted(() => ({ sent: [] as Array<Record<string, unknown>>, settings: null as unknown }));
vi.mock("../alerts/adsAlerts.js", () => ({ sendAdsAlert: vi.fn(async (_a: unknown, _o: string, alert: Record<string, unknown>) => { holder.sent.push(alert); return 2; }) }));
vi.mock("../settings/settingsVersions.js", () => ({ settingsInForce: vi.fn(async () => ({ settings: holder.settings })) }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const C1 = "00000000-0000-4000-8000-00000000aa01";
const C2 = "00000000-0000-4000-8000-00000000aa02";
const NOW = new Date("2026-11-20T13:00:00Z");
const row = (over: Partial<LeadQualityCounts>): LeadQualityCounts => ({
  campaign_id: C1, leads: 20, attempted: 10, wrong_number: 0, reached: 6, not_qualified: 0, median_first_attempt_minutes: 6, closed: {}, ...over,
});

let rec: SupabaseRecorder;
let asked: string[];
const quality = (rows: LeadQualityCounts[]) => ({ qualitySince: vi.fn(async (_org: string, since: string) => { asked.push(since); return rows; }) });
const run = (rows: LeadQualityCounts[]) => checkLeadQuality({ admin: rec.client as never, now: () => NOW, leadQuality: quality(rows) }, ORG);

beforeEach(() => {
  holder.sent = [];
  holder.settings = ADS_SETTINGS_UNSET;
  asked = [];
  rec = createSupabaseRecorder({ tables: { ads_campaigns: postgrestFixture([
    { org_id: ORG, id: C1, name: "Joliet Class A · Nov" }, { org_id: ORG, id: C2, name: "Gary regional" },
  ]) } });
});

describe("the lead-quality alert (LQ3b)", () => {
  it("with no saved group, the ruled defaults ring: 4 wrong numbers of 10 called is 40 %, named by the campaign", async () => {
    const r = await run([row({ wrong_number: 4 })]);
    expect([r.breaches.length, r.rung]).toEqual([1, 2]);
    expect(holder.sent[0]).toMatchObject({
      category: "ads_lead_quality", severity: "warning", entityType: "ads_campaigns", entityId: C1,
      dedupeKey: leadQualityDedupeKey(C1, "wrong_numbers"), title: "An ad's leads are mostly wrong numbers",
    });
    expect(String(holder.sent[0]!.body)).toContain("Joliet Class A · Nov: 4 of the 10 leads the team has called were wrong numbers (40%");
    expectOrgScoped(rec, ORG);
  });

  it("each campaign and each rule rings under its own key, so a campaign that stays bad is not rung again", async () => {
    await run([row({ wrong_number: 5, not_qualified: 9 }), row({ campaign_id: C2, not_qualified: 10 })]);
    expect(holder.sent.map((a) => a.dedupeKey)).toEqual([
      `ads_lead_quality:${C1}:wrong_numbers`, `ads_lead_quality:${C1}:not_qualified`, `ads_lead_quality:${C2}:not_qualified`,
    ]);
  });

  it("judges the last 14 days of arrivals", async () => {
    await run([]);
    expect(asked).toEqual(["2026-11-06T13:00:00.000Z"]);
  });

  it("switched off on Settings › Ads control, it reads nothing and rings nobody", async () => {
    holder.settings = { ...ADS_SETTINGS_UNSET, lead_quality: { enabled: false, min_attempted: 10, wrong_number_pct: 40, not_qualified_pct: 40 } } satisfies AdsSettings;
    const r = await run([row({ wrong_number: 10 })]);
    expect([r.breaches, holder.sent, asked]).toEqual([[], [], []]);
  });

  it("a ref that is not one of this carrier's campaigns rings nobody, and a non-uuid ref is never sent to the uuid column", async () => {
    const r = await run([row({ campaign_id: "00000000-0000-4000-8000-0000000000ff", wrong_number: 10 }), row({ campaign_id: "tenstreet-123", wrong_number: 10 })]);
    expect([r.breaches, holder.sent]).toEqual([[], []]);
    const asked = rec.queries.find((q) => q.table === "ads_campaigns")!;
    expect(JSON.stringify(asked.ops)).not.toContain("tenstreet-123");
  });

  it("moves no campaign and writes nothing: an alert, never a pause (Q-AD51 (a))", async () => {
    await run([row({ wrong_number: 10, not_qualified: 20 })]);
    expect([holder.sent.length, rec.writes()]).toEqual([2, []]);
  });
});
