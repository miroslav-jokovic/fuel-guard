import { describe, expect, it } from "vitest";
import { ADS_JOB_KINDS, foldAgents, foldConnections, foldJobs, tokenHealth, type HealthJobRow } from "./adsHealth.js";
import type { AdsTokenExpiry } from "./connectionContract.js";
import { formatDisplayDate } from "../displayDate.js";

const NOW = new Date("2026-11-18T15:00:00Z");
const read = (over: Partial<Extract<AdsTokenExpiry, { read: true }>> = {}): AdsTokenExpiry =>
  ({ read: true, valid: true, expires_at: null, never_expires: false, data_access_expires_at: null, checked_at: NOW.toISOString(), ...over });

describe("ADS_JOB_KINDS", () => {
  it("is every ads kind in the job catalogue, the swipe read and the render among them", () => {
    expect(ADS_JOB_KINDS).toEqual(expect.arrayContaining(["ads_step", "ads_lead_fetch", "ads_insights", "ads_reconcile", "ads_render", "ads_swipe_read", "ads_daily_brief"]));
    expect(ADS_JOB_KINDS).not.toContain("lead_uncontacted");
  });
});

describe("tokenHealth", () => {
  it("says each state of a token in words, with a tone", () => {
    expect(tokenHealth(null, NOW)).toMatchObject({ tone: "unknown", words: "Not read yet: test the connection." });
    expect(tokenHealth({ read: false, why: "no_app_id", error_code: null, checked_at: "" }, NOW)).toMatchObject({ tone: "unknown", words: expect.stringContaining("META_APP_ID") });
    expect(tokenHealth({ read: false, why: "simulator", error_code: null, checked_at: "" }, NOW).tone).toBe("ok");
    expect(tokenHealth(read({ never_expires: true }), NOW)).toMatchObject({ tone: "ok", words: "Issued not to expire." });
    expect(tokenHealth(read({ valid: false }), NOW).tone).toBe("bad");
    expect(tokenHealth(read({ expires_at: "2026-11-27T15:00:00.000Z" }), NOW)).toMatchObject({ tone: "warn", days_left: 9, words: `Expires on ${formatDisplayDate("2026-11-27T15:00:00.000Z")}, in 9 days.` });
    expect(tokenHealth(read({ expires_at: "2027-01-27T15:00:00.000Z" }), NOW).tone).toBe("ok");
    expect(tokenHealth(read({ expires_at: "2026-11-10T15:00:00.000Z" }), NOW)).toMatchObject({ tone: "bad", words: `Expired on ${formatDisplayDate("2026-11-10T15:00:00.000Z")}.` });
  });

  it("lists connected and failing connections only, with the token read from their last test", () => {
    const row = (id: string, status: string) => ({ id, provider: "meta", is_sandbox: false, status, last_test_at: null, last_error: null, last_test: { ok: true, checks: [], user: null, account: null, page: null, scopes_granted: [], scopes_extra: [], error_code: null, token_expiry: read({ never_expires: true }) } });
    expect(foldConnections([row("a", "connected"), row("b", "failing"), row("c", "disconnected")], NOW).map((c) => [c.id, c.token.tone])).toEqual([["a", "ok"], ["b", "ok"]]);
  });
});

describe("foldJobs", () => {
  const job = (kind: string, status: string, at: string, error: string | null = null): HealthJobRow => ({ kind, status, error, created_at: at, finished_at: status === "done" || status === "failed" ? at : null });
  it("counts each ads kind's runs; a kind whose newest finish failed is bad, one that recovered is a warning", () => {
    const out = foldJobs([
      job("ads_insights", "done", "2026-11-18T10:00:00Z"), job("ads_insights", "failed", "2026-11-18T11:00:00Z", "insights:account:token_invalid"),
      job("ads_reconcile", "failed", "2026-11-17T06:00:00Z", "x"), job("ads_reconcile", "done", "2026-11-18T06:00:00Z"),
      job("ads_render", "running", "2026-11-18T14:00:00Z"),
    ]);
    const by = Object.fromEntries(out.map((j) => [j.kind, j]));
    expect(by.ads_insights).toMatchObject({ done: 1, failed: 1, tone: "bad", last_error: "insights:account:token_invalid", last_failed_at: "2026-11-18T11:00:00Z" });
    expect(by.ads_reconcile).toMatchObject({ tone: "warn" });
    expect(by.ads_render).toMatchObject({ running: 1, tone: "ok" });
    expect(out.map((j) => j.kind)).toEqual([...ADS_JOB_KINDS]);
  });
});

describe("foldAgents", () => {
  it("counts calls, answers in shape, failures by code and budget refusals per agent, and the units billed", () => {
    const g = (agent: string, status: string, error_code: string | null, cost_units: number | string | null, cost_unit: string | null = "tokens") => ({ agent, status, error_code, cost_units, cost_unit });
    const out = foldAgents([
      g("copywriter", "succeeded", null, 1000), g("copywriter", "succeeded", null, "2000"), g("copywriter", "failed", "off_schema", 500),
      g("copywriter", "budget_exhausted", "budget_spent", null, null), g("renderer", "succeeded", null, 4, "credits"),
    ], { copywriter: true });
    const cw = out.find((a) => a.agent === "copywriter")!;
    expect(cw).toEqual({ agent: "copywriter", enabled: true, calls: 4, in_shape: 2, failed: 1, budget_refused: 1, in_shape_share: 0.667, failures: [{ code: "off_schema", count: 1 }], cost_units: 3500, cost_unit: "tokens" });
    expect(out.find((a) => a.agent === "renderer")).toMatchObject({ enabled: false, cost_unit: "credits", cost_units: 4 });
    expect(out.find((a) => a.agent === "researcher")).toMatchObject({ calls: 0, in_shape_share: null });
  });

  it("a month holding old credits and dollars shows the dollars alone, never their sum (Q-APX16)", () => {
    const out = foldAgents([
      { agent: "renderer", status: "succeeded", error_code: null, cost_units: 4, cost_unit: "credits" },
      { agent: "renderer", status: "succeeded", error_code: null, cost_units: "0.0940", cost_unit: "usd" },
      { agent: "renderer", status: "failed", error_code: "nsfw", cost_units: "0.0000", cost_unit: "usd" },
    ], {});
    expect(out.find((a) => a.agent === "renderer")).toMatchObject({ calls: 3, cost_unit: "usd", cost_units: 0.094 });
  });
});
