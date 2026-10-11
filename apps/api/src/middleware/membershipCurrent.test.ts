import { describe, expect, it, beforeEach } from "vitest";
import { createSupabaseRecorder, type RecordedQuery } from "../testing/supabaseRecorder.js";
import { membershipVerdict, forgetMembership, resetMembershipCache, MEMBERSHIP_CACHE_MS } from "./membershipCurrent.js";

/**
 * SP7 (Q-SET6 (a)): a signed token whose membership was removed, re-roled or suspended since is
 * refused by the API, not honoured until it expires. Each case is one way the old token outlived the
 * access it was minted from.
 */
const ORG = "00000000-0000-4000-8000-00000000000a";
const USER = "00000000-0000-4000-8000-000000000002";
const ctx = { userId: USER, orgId: ORG, role: "dispatcher" as const };

let reads = 0;
const recorderWith = (row: unknown, error: unknown = null) =>
  createSupabaseRecorder({
    tables: {
      memberships: (q: RecordedQuery) => {
        reads++;
        // Org AND user, or a same-user membership in another tenant would answer for this one.
        const f = q.filters();
        expect(f).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "user_id", val: USER }]));
        return { data: row === null ? [] : [row], error };
      },
    },
  });

beforeEach(() => {
  resetMembershipCache();
  reads = 0;
});

describe("membershipVerdict", () => {
  it("a membership with the token's role, not suspended, is current", async () => {
    expect(await membershipVerdict(recorderWith({ role: "dispatcher", suspended_at: null }).client, ctx)).toBe("current");
  });

  it("a removed membership is stale", async () => {
    expect(await membershipVerdict(recorderWith(null).client, ctx)).toBe("stale");
  });

  it("a suspended membership is stale", async () => {
    expect(await membershipVerdict(recorderWith({ role: "dispatcher", suspended_at: "2026-09-30T12:00:00Z" }).client, ctx)).toBe("stale");
  });

  it("a membership whose role changed since the token was minted is stale", async () => {
    expect(await membershipVerdict(recorderWith({ role: "admin", suspended_at: null }).client, ctx)).toBe("stale");
  });

  it("a token with no org claims nothing and is not looked up", async () => {
    expect(await membershipVerdict(recorderWith(null).client, { ...ctx, orgId: null })).toBe("current");
    expect(reads).toBe(0);
  });

  it("a current answer is cached for MEMBERSHIP_CACHE_MS, then read again", async () => {
    const rec = recorderWith({ role: "dispatcher", suspended_at: null });
    await membershipVerdict(rec.client, ctx, 1_000);
    await membershipVerdict(rec.client, ctx, 1_000 + MEMBERSHIP_CACHE_MS - 1);
    expect(reads).toBe(1);
    await membershipVerdict(rec.client, ctx, 1_000 + MEMBERSHIP_CACHE_MS);
    expect(reads).toBe(2);
  });

  it("a stale answer is never cached — a reinstated person is current on the next request", async () => {
    await membershipVerdict(recorderWith(null).client, ctx, 1_000);
    expect(await membershipVerdict(recorderWith({ role: "dispatcher", suspended_at: null }).client, ctx, 1_001)).toBe("current");
    expect(reads).toBe(2);
  });

  it("forgetMembership drops the cached answer, so a change made here applies at once", async () => {
    await membershipVerdict(recorderWith({ role: "dispatcher", suspended_at: null }).client, ctx, 1_000);
    forgetMembership(USER);
    expect(await membershipVerdict(recorderWith(null).client, ctx, 1_001)).toBe("stale");
  });

  it("a failed read is answered current (fail open) and NOT cached", async () => {
    expect(await membershipVerdict(recorderWith(null, { message: "boom" }).client, ctx, 1_000)).toBe("current");
    expect(await membershipVerdict(recorderWith(null).client, ctx, 1_001)).toBe("stale");
  });
});
