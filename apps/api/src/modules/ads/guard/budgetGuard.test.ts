import { describe, expect, it, vi } from "vitest";
import { ADS_SETTINGS_UNSET, type AdsSettings } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import type { PlatformOutcome } from "../platforms/adapter.js";
import { guardedAreaChange, guardedSpend, type SpendAsk } from "./budgetGuard.js";

const ORG = "org-a";
// Nov 15 in Chicago: 16 days left, today included. A $100/day launch forecasts $1,600 on its own.
const NOW = new Date("2026-11-15T18:00:00Z");
const PERSON = { kind: "person" as const, id: "11111111-1111-4111-8111-111111111111", name: "Owner" };

const SETTINGS: AdsSettings = {
  ...ADS_SETTINGS_UNSET,
  limits: { monthly_cap_cents: { meta: 300_000 }, daily_max_cents: 10_000, lifetime_max_cents: 150_000, max_raise_pct: 25, max_raise_cents: 5_000 },
};

interface World {
  settings?: AdsSettings;
  kill?: boolean;
  spendHours?: Array<{ campaign_id: string; spend_cents: number }>;
  others?: Array<{ id: string; state: string; daily_budget_cents: number | null }>;
  approvals?: Array<Record<string, unknown>>;
  usedApprovalIds?: string[];
  startError?: { code: string; message: string };
  campaignDaily?: number | null;
}

const approval = (patch: Record<string, unknown> = {}) => ({
  id: "appr-1", kind: "launch", withdraws_id: null, approved_by: "u-1", approved_by_name: "Owner",
  daily_budget_cents: 10_000, lifetime_cap_cents: 100_000, created_at: "2026-11-15T17:00:00Z", ...patch,
});

const filter = (q: RecordedQuery, col: string) => q.filters().find((f) => f.col === col)?.val;

function world(w: World = {}) {
  const campaign = { id: "camp-1", connection_id: "conn-1", state: "paused", daily_budget_cents: w.campaignDaily ?? null, platform_refs: { campaign: "m-1" } };
  return createSupabaseRecorder({
    tables: {
      ads_campaigns: (q) => (filter(q, "id") ? [campaign] : [{ id: "camp-1", state: "paused", daily_budget_cents: null }, ...(w.others ?? [])]),
      ads_platform_connections: (q) => (filter(q, "id") ? [{ provider: "meta" }] : [{ id: "conn-1" }]),
      ads_settings_versions: [{ id: "v1", version: 3, settings: w.settings ?? SETTINGS, kill_switch: w.kill ?? false, kill_reason: w.kill ? "audit" : null, created_at: "2026-11-01T00:00:00Z", created_by_name: "Owner" }],
      ads_spend_hourly: (q) =>
        (w.spendHours ?? [])
          .filter((h) => h.campaign_id === filter(q, "campaign_id"))
          .map((h) => ({ ...h, hour: "2026-11-10T12:00:00.000Z", impressions: 0, clicks: 0, leads: 0 })),
      ads_approvals: w.approvals ?? [approval()],
      ads_actions: (q) => {
        if (q.write?.method === "insert") {
          const status = (q.write.payload as { status: string }).status;
          if (status === "started" && w.startError) return { data: null, error: w.startError, writeError: w.startError };
          return [{ id: status === "started" ? "act-started" : "act-refused" }];
        }
        if (q.write) return [];
        return (w.usedApprovalIds ?? []).map((approval_id) => ({ approval_id }));
      },
    },
  });
}

function platform(limit: number | null = 300_000, outcome: PlatformOutcome | Error = { ok: true, platform_refs: { ad_set: "s-1" } }) {
  const act = vi.fn(async () => {
    if (outcome instanceof Error) throw outcome;
    return outcome;
  });
  return {
    safe: { readAccountLimitCents: vi.fn(async () => limit), pause: vi.fn(async () => ({ ok: true as const })) },
    spend: { launch: act, raiseDailyBudget: vi.fn(act), changeArea: vi.fn(act) },
  };
}

const launch = (patch: Partial<SpendAsk> = {}): SpendAsk => ({
  orgId: ORG, campaignId: "camp-1", act: "launch", daily_cents: 10_000, lifetime_cents: 100_000, actor: PERSON, ...patch,
});
const run = (rec: ReturnType<typeof world>, p: ReturnType<typeof platform>, ask = launch()) =>
  guardedSpend({ admin: rec.client, now: () => NOW, safe: p.safe, spend: p.spend }, ask);
const actionInserts = (rec: ReturnType<typeof world>) =>
  rec.forTable("ads_actions").filter((q) => q.write?.method === "insert").map((q) => q.write!.payload as Record<string, unknown>);

describe("guardedSpend — a launch that passes every fence", () => {
  it("writes started before the call, calls the platform once, completes succeeded", async () => {
    const rec = world();
    const p = platform();
    p.spend.launch.mockImplementationOnce(async () => {
      expect(actionInserts(rec)).toEqual([expect.objectContaining({ status: "started", kind: "launch", approval_id: "appr-1", idempotency_key: "launch:appr-1" })]);
      return { ok: true, platform_refs: { ad_set: "s-1" } };
    });
    expect(await run(rec, p)).toEqual({ kind: "succeeded", action_id: "act-started" });
    expect(p.spend.launch).toHaveBeenCalledTimes(1);
    expect(p.spend.launch).toHaveBeenCalledWith(expect.objectContaining({ daily_budget_cents: 10_000, idempotency_key: "launch:appr-1" }));
    const done = rec.forTable("ads_actions").find((q) => q.write?.method === "update")!;
    expect(done.write!.payload).toMatchObject({ status: "succeeded", platform_refs: { ad_set: "s-1" } });
    expect(done.filters()).toEqual(expect.arrayContaining([{ col: "status", val: "started" }]));
  });

  it("every query and write names the org", async () => {
    const rec = world();
    await run(rec, platform());
    expectOrgScoped(rec, ORG);
  });
});

describe("guardedSpend — the fences (each refusal is a row, and no platform call)", () => {
  const refusedWith = async (w: World, p = platform(), ask = launch()) => {
    const rec = world(w);
    const out = await run(rec, p, ask);
    expect(p.spend.launch).not.toHaveBeenCalled();
    expect(p.spend.raiseDailyBudget).not.toHaveBeenCalled();
    expect(actionInserts(rec)).toEqual([expect.objectContaining({ status: "refused" })]);
    // A refusal cites no approval: AX020 lets a refused row through precisely because it attempted nothing.
    expect(actionInserts(rec)[0]).not.toHaveProperty("approval_id");
    expect(out.kind).toBe("refused");
    return out.kind === "refused" ? out.refusals : [];
  };

  it("the kill switch blocks a launch", async () => {
    expect(await refusedWith({ kill: true })).toContain("kill_switch_on");
  });

  it("a forecast exactly at the monthly cap launches; one cent over is refused", async () => {
    // 16 days × $100 = $1,600; month-to-date $1,400 lands on the $3,000 cap exactly.
    const ok = world({ spendHours: [{ campaign_id: "camp-1", spend_cents: 140_000 }] });
    expect((await run(ok, platform())).kind).toBe("succeeded");
    expect(await refusedWith({ spendHours: [{ campaign_id: "camp-1", spend_cents: 140_001 }] })).toEqual(["monthly_cap_forecast"]);
  });

  it("the other live campaigns' daily budgets count in the forecast; a paused one does not", async () => {
    const others = [
      { id: "camp-2", state: "live", daily_budget_cents: 8_751 }, // 16 × 8,751 = 140,016 > the 140,000 left
      { id: "camp-3", state: "paused", daily_budget_cents: 50_000 },
    ];
    expect(await refusedWith({ others })).toEqual(["monthly_cap_forecast"]);
    const fits = world({ others: [{ id: "camp-2", state: "live", daily_budget_cents: 8_750 }, others[1]!] });
    expect((await run(fits, platform())).kind).toBe("succeeded");
  });

  it("unset caps refuse", async () => {
    expect(await refusedWith({ settings: ADS_SETTINGS_UNSET })).toContain("caps_not_set");
  });

  it("an unreadable account limit refuses", async () => {
    expect(await refusedWith({}, platform(null))).toContain("account_limit_unknown");
  });

  it("no approval refuses", async () => {
    expect(await refusedWith({ approvals: [] })).toEqual(["no_standing_approval"]);
  });

  it("an approval of a smaller amount does not cover a larger launch", async () => {
    expect(await refusedWith({ approvals: [approval({ daily_budget_cents: 9_999 })] })).toEqual(["no_standing_approval"]);
    expect(await refusedWith({ approvals: [approval({ lifetime_cap_cents: 99_999 })] })).toEqual(["no_standing_approval"]);
  });

  it("an approval already used by an act does not launch again", async () => {
    expect(await refusedWith({ usedApprovalIds: ["appr-1"] })).toEqual(["no_standing_approval"]);
  });

  it("a withdrawn approval does not launch", async () => {
    const approvals = [approval(), approval({ id: "w-1", kind: "withdraw", withdraws_id: "appr-1", daily_budget_cents: null, lifetime_cap_cents: null })];
    expect(await refusedWith({ approvals })).toEqual(["no_standing_approval"]);
  });

  it("above the second-approver line, one person — or the same person twice — is not enough", async () => {
    const settings = { ...SETTINGS, approvals: { second_approver_above_cents: 5_000 } };
    expect(await refusedWith({ settings })).toEqual(["second_approver_missing"]);
    const samePerson = [approval(), approval({ id: "appr-2", created_at: "2026-11-15T17:30:00Z" })];
    expect(await refusedWith({ settings, approvals: samePerson })).toEqual(["second_approver_missing"]);
    const two = world({ settings, approvals: [approval({ id: "appr-2", approved_by: "u-2", created_at: "2026-11-15T17:30:00Z" }), approval()] });
    const p = platform();
    expect(await run(two, p)).toEqual({ kind: "succeeded", action_id: "act-started" });
    expect(actionInserts(two)[0]).toMatchObject({ approval_id: "appr-2" });
  });

  it("a raise past the raise limit is refused", async () => {
    const ask = launch({ act: "raise_budget", daily_cents: 10_000 });
    expect(await refusedWith({ campaignDaily: 7_000, approvals: [approval({ kind: "raise_budget" })] }, platform(), ask)).toEqual(["raise_over_limit"]);
  });
});

describe("guardedSpend — races and failures", () => {
  it("the kill switch pressed between the guard's read and the write (AX021) is a refusal, not a call", async () => {
    const rec = world({ startError: { code: "AX021", message: "kill switch" } });
    const p = platform();
    expect(await run(rec, p)).toEqual({ kind: "refused", action_id: "act-refused", refusals: ["kill_switch_on"] });
    expect(p.spend.launch).not.toHaveBeenCalled();
  });

  it("a job delivered twice finds the first act and calls nothing", async () => {
    const rec = world({ startError: { code: "23505", message: "duplicate" } });
    const p = platform();
    expect(await run(rec, p)).toEqual({ kind: "already_attempted" });
    expect(p.spend.launch).not.toHaveBeenCalled();
  });

  it("a platform refusal and a thrown adapter error both complete the row as failed", async () => {
    for (const outcome of [{ ok: false as const, error_code: "meta_2703" }, new Error("socket hang up")]) {
      const rec = world();
      const out = await run(rec, platform(300_000, outcome));
      expect(out.kind).toBe("failed");
      const done = rec.forTable("ads_actions").find((q) => q.write?.method === "update")!;
      expect(done.write!.payload).toMatchObject({ status: "failed", error_code: outcome instanceof Error ? "platform_error" : "meta_2703" });
    }
  });
});

describe("guardedAreaChange", () => {
  it("needs a standing change_area approval; with one, calls changeArea once", async () => {
    const area = { kind: "radius" as const, lat: 41.88, lng: -87.63, radius_miles: 50, label: "Chicago yard", reason: "home daily" };
    const none = world({ approvals: [] });
    const p = platform();
    const refused = await guardedAreaChange({ admin: none.client, now: () => NOW, safe: p.safe, spend: p.spend }, { orgId: ORG, campaignId: "camp-1", area: area as never, actor: PERSON });
    expect(refused).toMatchObject({ kind: "refused", refusals: ["no_standing_approval"] });
    expect(p.spend.changeArea).not.toHaveBeenCalled();

    const ok = world({ approvals: [approval({ kind: "change_area", daily_budget_cents: null, lifetime_cap_cents: null })] });
    const out = await guardedAreaChange({ admin: ok.client, now: () => NOW, safe: p.safe, spend: p.spend }, { orgId: ORG, campaignId: "camp-1", area: area as never, actor: PERSON });
    expect(out.kind).toBe("succeeded");
    expect(p.spend.changeArea).toHaveBeenCalledTimes(1);
    expectOrgScoped(ok, ORG);
  });
});
