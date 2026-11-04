import { describe, expect, it, vi } from "vitest";
import { ADMIN_USER, createAdsWorld, CONN, LIVE_SETTINGS, ORG } from "../../../testing/adsWorld.js";
import { expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { alertBackfillStale, alertWebhookLate, BACKFILL_STALE_HOURS } from "./intakeAlerts.js";

/** Leads that stop arriving on time reach a person (D2d). The bell is the world's `emit_notification`, with its dedupe. */

const NOW = new Date("2026-11-03T15:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const RECRUITER = "00000000-0000-4000-8000-0000000000d2";
const admin = { org_id: ORG, user_id: ADMIN_USER, role: "admin", suspended_at: null };
const world = () => createAdsWorld({ campaigns: [], members: [admin] });

describe("a connection whose backfill keeps failing", () => {
  it("says nothing before the third hour, and rings the admins from it, as a warning", async () => {
    const w = world();
    await alertBackfillStale(w.admin, ORG, CONN, hoursAgo(BACKFILL_STALE_HOURS - 0.5), NOW);
    expect(w.bell).toEqual([]);
    await alertBackfillStale(w.admin, ORG, CONN, hoursAgo(BACKFILL_STALE_HOURS), NOW);
    expect(w.bell).toEqual([expect.objectContaining({ user: ADMIN_USER, category: "lead_intake_failing", severity: "warning" })]);
    expectOrgScoped(w.rec, ORG);
  });

  it("a connection that has never worked rings on its first failure", async () => {
    const w = world();
    await alertBackfillStale(w.admin, ORG, CONN, null, NOW);
    expect(w.bell.map((b) => b.title)).toEqual(["Ad leads are not arriving"]);
  });

  it("is once a day: the next hour's failure is the same outage, and the next day's is a new item", async () => {
    const w = world();
    await alertBackfillStale(w.admin, ORG, CONN, hoursAgo(4), NOW);
    await alertBackfillStale(w.admin, ORG, CONN, hoursAgo(5), new Date(NOW.getTime() + 3_600_000));
    expect(w.bell).toHaveLength(1);
    await alertBackfillStale(w.admin, ORG, CONN, hoursAgo(28), new Date(NOW.getTime() + 24 * 3_600_000));
    expect(w.bell).toHaveLength(2);
  });

  it("goes to the carrier's list for this category when there is one", async () => {
    const settings = { ...LIVE_SETTINGS, alerts: { ...LIVE_SETTINGS.alerts, recipients: { lead_intake_failing: [RECRUITER] } } };
    const w = createAdsWorld({ campaigns: [], settings, members: [admin, { org_id: ORG, user_id: RECRUITER, role: "manager", suspended_at: null }] });
    await alertBackfillStale(w.admin, ORG, CONN, null, NOW);
    expect(w.bell.map((b) => b.user)).toEqual([RECRUITER]);
  });

  it("an alert that cannot be sent never reaches the job", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { from: () => { throw new Error("database down"); }, rpc: () => { throw new Error("database down"); } };
    await expect(alertBackfillStale(broken as never, ORG, CONN, null, NOW)).resolves.toBeUndefined();
    await expect(alertWebhookLate(broken as never, ORG, CONN, 360_000, NOW)).resolves.toBeUndefined();
    expect(quiet).toHaveBeenCalledTimes(2);
    quiet.mockRestore();
  });
});

describe("a webhook lead that took too long", () => {
  it("rings once a day per connection, separately from a failing backfill", async () => {
    const w = world();
    await alertWebhookLate(w.admin, ORG, CONN, 360_000, NOW);
    await alertWebhookLate(w.admin, ORG, CONN, 900_000, new Date(NOW.getTime() + 60_000));
    await alertBackfillStale(w.admin, ORG, CONN, null, NOW);
    expect(w.bell.map((b) => b.title)).toEqual(["Ad leads are arriving late", "Ad leads are not arriving"]);
  });
});
