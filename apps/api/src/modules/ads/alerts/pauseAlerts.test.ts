import { describe, expect, it, vi } from "vitest";
import { ADMIN_USER, campaign, CONN, createAdsWorld, LIVE_SETTINGS, ORG, type AdsWorld } from "../../../testing/adsWorld.js";
import { expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { guardPlatform } from "../guard/guardedPlatform.js";
import type { PlatformOutcome } from "../platforms/adapter.js";
import { runCampaignStep } from "../orchestrator/runner.js";
import type { CampaignWorkers } from "../orchestrator/workers.js";
import { STUCK_AFTER } from "./pauseAlerts.js";
import { configuredAlertRecipients } from "./adsAlerts.js";

/**
 * The 2026-11-03 audit's H2 over the real runner: a pause the platform keeps refusing reaches a person.
 * The bell is the world's `emit_notification`, with its dedupe, so "one per hour" is the database's
 * answer here as it is in production.
 */
const RECRUITER = "00000000-0000-4000-8000-0000000000d2";

function pausing(w: AdsWorld, pause: () => Promise<PlatformOutcome>, platform = true): CampaignWorkers {
  const adapter = {
    safe: { readAccountHeadroomCents: vi.fn(async () => 300_000), readSpendCents: vi.fn(async () => 0), pause: vi.fn(pause), pauseAd: vi.fn(async () => ({ ok: true as const })), activateAd: vi.fn(async () => ({ ok: true as const })) },
    spend: { launch: vi.fn(), raiseDailyBudget: vi.fn(), changeArea: vi.fn() },
  };
  return { compose: null, createPaused: null, refresh: null, platform: platform ? async (_o, conn) => (conn === CONN ? guardPlatform(w.admin, w.now, "meta", adapter) : null) : async () => null };
}

const steps = async (w: AdsWorld, workers: CampaignWorkers, n: number) => {
  for (let i = 0; i < n; i += 1) await runCampaignStep({ admin: w.admin, now: w.now, workers }, ORG, "c1");
};

describe("a pause the platform keeps refusing reaches a person (audit H2)", () => {
  it("is quiet for a blip, then one critical 'could not be paused' to the admins at the third failure in a row, and no repeat within the hour", async () => {
    // From live, under the kill switch: the history holds the `kill` move before the failures, so "in a
    // row" is tested against an older move that is not a failure.
    const w = createAdsWorld({ campaigns: [campaign("c1", "live")], kill: true });
    const workers = pausing(w, async () => ({ ok: false, error_code: "meta_2" }));
    await steps(w, workers, 1);
    expect(w.byId("c1").state).toBe("pausing");
    await steps(w, workers, STUCK_AFTER - 1);
    expect(w.bell).toEqual([]);
    await steps(w, workers, 1);
    expect(w.bell).toEqual([{ user: ADMIN_USER, category: "ads_pause_failed", title: "An ad could not be paused", severity: "critical", dedupe: expect.stringMatching(/^ads_pause_failed:c1:2026-11-02T12$/) }]);
    await steps(w, workers, 5);
    expect(w.bell).toHaveLength(1);
    expect(w.byId("c1").state).toBe("pausing");
    expectOrgScoped(w.rec, ORG);
  });

  it("two failures and then a pause that takes: no alert", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c1", "pausing")] });
    let n = 0;
    const workers = pausing(w, async () => (++n === 3 ? { ok: true } : { ok: false, error_code: "rate_limited" }));
    await steps(w, workers, 3);
    expect(w.byId("c1").state).toBe("paused");
    expect(w.bell).toEqual([]);
  });

  it("goes to the recipients chosen on Settings › Ads control, and back to the admins when none of them is an active member", async () => {
    const settings = { ...LIVE_SETTINGS, alerts: { ...LIVE_SETTINGS.alerts, recipients: { ads_pause_failed: [RECRUITER] } } };
    const members = [{ org_id: ORG, user_id: ADMIN_USER, role: "admin", suspended_at: null }, { org_id: ORG, user_id: RECRUITER, role: "manager", suspended_at: null }];
    const chosen = createAdsWorld({ campaigns: [campaign("c1", "pausing")], settings, members });
    await steps(chosen, pausing(chosen, async () => ({ ok: false, error_code: "meta_2" })), STUCK_AFTER);
    expect(chosen.bell.map((b) => b.user)).toEqual([RECRUITER]);

    const gone = createAdsWorld({ campaigns: [campaign("c1", "pausing")], settings, members: [members[0]!] });
    await steps(gone, pausing(gone, async () => ({ ok: false, error_code: "meta_2" })), STUCK_AFTER);
    expect(gone.bell.map((b) => b.user)).toEqual([ADMIN_USER]);
  });

  it("a lead category reads the same list with no admin fallback: recruiting's alert has its own (D2b)", async () => {
    const settings = { ...LIVE_SETTINGS, alerts: { ...LIVE_SETTINGS.alerts, recipients: { lead_new: [RECRUITER] } } };
    const admin = { org_id: ORG, user_id: ADMIN_USER, role: "admin", suspended_at: null };
    const chosen = createAdsWorld({ campaigns: [], settings, members: [admin, { org_id: ORG, user_id: RECRUITER, role: "recruiter", suspended_at: null }] });
    expect(await configuredAlertRecipients(chosen.admin, ORG, "lead_new")).toEqual([RECRUITER]);
    const gone = createAdsWorld({ campaigns: [], settings, members: [admin] });
    expect(await configuredAlertRecipients(gone.admin, ORG, "lead_new")).toEqual([]);
  });

  it("a revoked token marks the connection failing and says so once a day, beside the stuck-pause alert", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c1", "pausing")], connections: [{ id: CONN, org_id: ORG, provider: "meta", status: "connected" }] });
    await steps(w, pausing(w, async () => ({ ok: false, error_code: "token_invalid" })), STUCK_AFTER);
    expect(w.connections[0]).toMatchObject({ status: "failing", last_error: "pause: token_invalid" });
    expect(w.bell.map((b) => b.category)).toEqual(["ads_token_expiring", "ads_pause_failed"]);
  });

  it("no usable connection at all (a key this deploy cannot open) is told the same way, though no pause row was ever written", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c1", "pausing")], connections: [{ id: CONN, org_id: ORG, provider: "meta", status: "connected" }] });
    await steps(w, pausing(w, async () => ({ ok: true }), false), STUCK_AFTER);
    expect(w.actions.filter((a) => a.kind === "pause")).toEqual([]);
    expect(w.connections[0]).toMatchObject({ status: "failing" });
    expect(w.bell.map((b) => b.category)).toEqual(["ads_token_expiring", "ads_pause_failed"]);
  });

  it("a connection a person disconnected is never relabelled failing by the pause path", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c1", "pausing")], connections: [{ id: CONN, org_id: ORG, provider: "meta", status: "disconnected" }] });
    await steps(w, pausing(w, async () => ({ ok: true }), false), 1);
    expect(w.connections[0]).toMatchObject({ status: "disconnected" });
  });

  it("an alert that cannot be sent never fails the step: the move is recorded and the next tick pauses again", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c1", "pausing")], members: [] });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    await steps(w, pausing(w, async () => ({ ok: false, error_code: "meta_2" })), STUCK_AFTER);
    expect(quiet).toHaveBeenCalledWith(expect.stringMatching(/ads_pause_failed has nobody to tell/));
    quiet.mockRestore();
    expect(w.transitions().filter((t) => (t.request as { event?: string }).event === "pause_failed")).toHaveLength(STUCK_AFTER);
  });
});
