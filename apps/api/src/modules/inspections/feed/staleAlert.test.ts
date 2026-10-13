import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";

/**
 * The stale-FMCSA-record alert (IC1c). What it can get wrong: alert on a fresh record, stay silent on
 * a late one, alert the wrong people, or alert every hour instead of once a day.
 */

const sent: { userId: string; category: string; title: string; dedupeKey?: string }[] = [];
vi.mock("../../messaging/index.js", () => ({
  notify: vi.fn(async (_admin: unknown, input: { userId: string; category: string; title: string; dedupeKey?: string }) => {
    sent.push(input);
    return `n-${sent.length}`;
  }),
}));
const managersAsked: string[] = [];
vi.mock("../../org/index.js", () => ({
  usersWhoManage: vi.fn(async (_admin: unknown, _org: string, section: string) => {
    managersAsked.push(section);
    return ["u-safety", "u-admin"];
  }),
}));

const { alertIfFeedStale, staleFeedNotice } = await import("./staleAlert.js");

const ORG = "org-1";
const NOW = Date.parse("2026-10-15T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
let rec: SupabaseRecorder;
const runs = (row: { finished_at: string; source_rows_updated_at: string | null } | null) =>
  createSupabaseRecorder({ tables: { fmcsa_fetch_runs: (_q: RecordedQuery) => (row ? [row] : []) } });

beforeEach(() => {
  sent.length = 0;
  managersAsked.length = 0;
});

describe("the stale-record alert", () => {
  it("says nothing while the record is fresh", async () => {
    rec = runs({ finished_at: hoursAgo(3), source_rows_updated_at: hoursAgo(9) });
    expect(await alertIfFeedStale(rec.client, ORG, NOW)).toBe(0);
    expect(sent).toEqual([]);
  });

  it("tells the safety section's managers when our fetch is late, once a day per state", async () => {
    rec = runs({ finished_at: hoursAgo(40), source_rows_updated_at: hoursAgo(45) });
    expect(await alertIfFeedStale(rec.client, ORG, NOW, "America/Chicago")).toBe(2);
    expect(managersAsked).toEqual(["safety"]);
    expect(sent.map((n) => [n.userId, n.category, n.dedupeKey])).toEqual([
      ["u-safety", "roadside_feed_stale", "roadside-feed-stale:ours_late:2026-10-15"],
      ["u-admin", "roadside_feed_stale", "roadside-feed-stale:ours_late:2026-10-15"],
    ]);
    expectOrgScoped(rec, ORG);
  });

  it("alerts when FMCSA stopped publishing, and when no fetch has ever succeeded", async () => {
    rec = runs({ finished_at: hoursAgo(2), source_rows_updated_at: hoursAgo(80) });
    await alertIfFeedStale(rec.client, ORG, NOW);
    rec = runs(null);
    await alertIfFeedStale(rec.client, ORG, NOW);
    expect([...new Set(sent.map((n) => n.dedupeKey))]).toEqual([
      "roadside-feed-stale:fmcsa_late:2026-10-15",
      "roadside-feed-stale:never:2026-10-15",
    ]);
  });

  it("never throws into the scheduler when the read fails", async () => {
    rec = createSupabaseRecorder({ tables: { fmcsa_fetch_runs: () => ({ data: null, error: { message: "boom" } }) } });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(alertIfFeedStale(rec.client, ORG, NOW)).resolves.toBe(0);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("the notice's words", () => {
  it("names the time on the org's clock and says whose side stopped", () => {
    const ours = staleFeedNotice({ fetchedAt: "2026-10-13T14:17:00Z", sourceUpdatedAt: null, state: "ours_late" }, "America/Chicago");
    expect(ours?.body).toContain("since 10/13/2026 9:17 AM");
    expect(staleFeedNotice({ fetchedAt: "2026-10-15T10:00:00Z", sourceUpdatedAt: "2026-10-11T03:00:00Z", state: "fmcsa_late" })?.title).toBe(
      "FMCSA has stopped publishing",
    );
    expect(staleFeedNotice({ fetchedAt: "2026-10-15T10:00:00Z", sourceUpdatedAt: null, state: "fresh" })).toBeNull();
  });
});
