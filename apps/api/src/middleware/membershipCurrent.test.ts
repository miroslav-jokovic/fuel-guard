import { describe, expect, it, beforeEach, vi } from "vitest";
import { createSupabaseRecorder, type RecordedQuery } from "../testing/supabaseRecorder.js";
import { membershipVerdict, forgetMembership, resetMembershipCache, MEMBERSHIP_CACHE_MS } from "./membershipCurrent.js";

/**
 * SP7 (Q-SET6 (a)): a signed token whose membership was removed, re-roled or suspended since is
 * refused by the API, not honoured until it expires. And Q-IA10 (0616): so is one whose session was
 * ended — the device was signed out. Each case is one way the old token outlived what it was minted from.
 * And IA-S1 (0617): so is one whose owner must take the second step and has not. What the function
 * answers is 0617's, executed by `supabase/tests/second-factor-state.test.mjs`; the rule is
 * `secondFactorRequired` in shared; this file holds the API to what it ASKS and what it makes of each answer.
 */
const ORG = "00000000-0000-4000-8000-00000000000a";
const USER = "00000000-0000-4000-8000-000000000002";
const SESSION = "5e551011-0000-4000-8000-000000000001";
const OTHER_SESSION = "5e551011-0000-4000-8000-000000000002";
const ctx = { userId: USER, orgId: ORG, role: "dispatcher" as const, sessionId: SESSION };

let reads = 0;
let asked: Array<Record<string, unknown>> = [];
/** The database with 0617: every answer comes from `member_access_state`. `row` null = no membership. */
const recorderWith = (row: unknown, error: unknown = null) =>
  createSupabaseRecorder({
    rpc: (fn, args) => {
      if (fn !== "member_access_state") return undefined;
      reads++;
      asked.push(args as Record<string, unknown>);
      return error ? { error } : row === null ? [] : [row];
    },
    tables: { memberships: () => { throw new Error("the table must not be read when the function answers"); } },
  });
const FAR = "2099-01-01T00:00:00Z";
const PAST = "2026-01-01T00:00:00Z";
const ALIVE = { role: "dispatcher", suspended_at: null, session_alive: true, second_factor_required_from: FAR, has_second_factor: false };

beforeEach(() => {
  resetMembershipCache();
  reads = 0;
  asked = [];
});

describe("membershipVerdict — the membership", () => {
  it("a membership with the token's role, not suspended, on a live session, is current", async () => {
    expect(await membershipVerdict(recorderWith(ALIVE).client, ctx)).toBe("current");
    // Org, person and session come from the token; one call, nothing else.
    expect(asked).toEqual([{ p_org: ORG, p_user: USER, p_session: SESSION }]);
  });

  it("a removed membership is stale", async () => {
    expect(await membershipVerdict(recorderWith(null).client, ctx)).toBe("stale");
  });

  it("a suspended membership is stale", async () => {
    expect(await membershipVerdict(recorderWith({ ...ALIVE, suspended_at: "2026-09-30T12:00:00Z" }).client, ctx)).toBe("stale");
  });

  it("a membership whose role changed since the token was minted is stale", async () => {
    expect(await membershipVerdict(recorderWith({ ...ALIVE, role: "admin" }).client, ctx)).toBe("stale");
  });

  it("a token with no org claims nothing and is not looked up", async () => {
    expect(await membershipVerdict(recorderWith(null).client, { ...ctx, orgId: null })).toBe("current");
    expect(reads).toBe(0);
  });
});

describe("membershipVerdict — the session (Q-IA10)", () => {
  it("a token whose session was ended is signed out", async () => {
    expect(await membershipVerdict(recorderWith({ ...ALIVE, session_alive: false }).client, ctx)).toBe("signed_out");
  });

  it("a changed membership outranks an ended session: the person is told their access changed", async () => {
    expect(await membershipVerdict(recorderWith({ role: "admin", suspended_at: null, session_alive: false }).client, ctx)).toBe("stale");
  });

  it("a token that names no session cannot be told, and stands", async () => {
    expect(await membershipVerdict(recorderWith({ ...ALIVE, session_alive: null }).client, { ...ctx, sessionId: null })).toBe("current");
    expect(asked).toEqual([{ p_org: ORG, p_user: USER, p_session: null }]);
  });

  it("never sends the database a session claim that is not an id", async () => {
    await membershipVerdict(recorderWith({ ...ALIVE, session_alive: null }).client, { ...ctx, sessionId: "'; drop table x; --" });
    expect(asked[0]!.p_session).toBeNull();
  });

  it("a signed-out answer is never cached — and never served from another session's cache", async () => {
    await membershipVerdict(recorderWith(ALIVE).client, ctx, 1_000); // the PC is current, and cached
    // The phone, same person, a second later: asked for itself, not answered from the PC's entry.
    const phone = { ...ctx, sessionId: OTHER_SESSION };
    expect(await membershipVerdict(recorderWith({ ...ALIVE, session_alive: false }).client, phone, 2_000)).toBe("signed_out");
    expect(await membershipVerdict(recorderWith({ ...ALIVE, session_alive: false }).client, phone, 2_001)).toBe("signed_out");
    expect(reads).toBe(3);
  });

  it("forgetMembership drops every session of the person, so an ended device is refused at once", async () => {
    await membershipVerdict(recorderWith(ALIVE).client, ctx, 1_000);
    await membershipVerdict(recorderWith(ALIVE).client, { ...ctx, sessionId: OTHER_SESSION }, 1_000);
    forgetMembership(USER);
    expect(await membershipVerdict(recorderWith({ ...ALIVE, session_alive: false }).client, ctx, 1_001)).toBe("signed_out");
    expect(await membershipVerdict(recorderWith({ ...ALIVE, session_alive: false }).client, { ...ctx, sessionId: OTHER_SESSION }, 1_001)).toBe("signed_out");
  });
});

describe("membershipVerdict — the cache and a failed read", () => {
  it("a current answer is cached for MEMBERSHIP_CACHE_MS, then read again", async () => {
    const rec = recorderWith(ALIVE);
    await membershipVerdict(rec.client, ctx, 1_000);
    await membershipVerdict(rec.client, ctx, 1_000 + MEMBERSHIP_CACHE_MS - 1);
    expect(reads).toBe(1);
    await membershipVerdict(rec.client, ctx, 1_000 + MEMBERSHIP_CACHE_MS);
    expect(reads).toBe(2);
  });

  it("a stale answer is never cached — a reinstated person is current on the next request", async () => {
    await membershipVerdict(recorderWith(null).client, ctx, 1_000);
    expect(await membershipVerdict(recorderWith(ALIVE).client, ctx, 1_001)).toBe("current");
    expect(reads).toBe(2);
  });

  it("forgetMembership drops the cached answer, so a change made here applies at once", async () => {
    await membershipVerdict(recorderWith(ALIVE).client, ctx, 1_000);
    forgetMembership(USER);
    expect(await membershipVerdict(recorderWith(null).client, ctx, 1_001)).toBe("stale");
  });

  it("a failed read is answered current (fail open) and NOT cached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await membershipVerdict(recorderWith(null, { code: "57014", message: "boom" }).client, ctx, 1_000)).toBe("current");
    expect(await membershipVerdict(recorderWith(null).client, ctx, 1_001)).toBe("stale");
  });
});

describe("membershipVerdict — the second step (IA-S1)", () => {
  const admin = { ...ctx, role: "admin" as const };
  const ADMIN = { ...ALIVE, role: "admin" };

  it("an admin whose company's date has passed, on a one-step session, owes the second step", async () => {
    expect(await membershipVerdict(recorderWith({ ...ADMIN, second_factor_required_from: PAST }).client, { ...admin, aal: "aal1" })).toBe("second_factor");
  });

  it("...and is current once the session has taken it", async () => {
    expect(await membershipVerdict(recorderWith({ ...ADMIN, second_factor_required_from: PAST }).client, { ...admin, aal: "aal2" })).toBe("current");
  });

  it("an admin inside their 14 days is not asked yet", async () => {
    expect(await membershipVerdict(recorderWith(ADMIN).client, { ...admin, aal: "aal1" })).toBe("current");
  });

  it("a dispatcher is never required by the date — it is the admin role's alone", async () => {
    expect(await membershipVerdict(recorderWith({ ...ALIVE, second_factor_required_from: PAST }).client, { ...ctx, aal: "aal1" })).toBe("current");
  });

  it("anybody who HAS a factor owes it, whatever their role and whatever the date", async () => {
    expect(await membershipVerdict(recorderWith({ ...ALIVE, has_second_factor: true }).client, { ...ctx, aal: "aal1" })).toBe("second_factor");
    expect(await membershipVerdict(recorderWith({ ...ALIVE, has_second_factor: true }).client, { ...ctx, aal: "aal2" })).toBe("current");
  });

  it("a token that does not say its level has not taken the step", async () => {
    expect(await membershipVerdict(recorderWith({ ...ALIVE, has_second_factor: true }).client, ctx)).toBe("second_factor");
  });

  it("a removed membership and a signed-out device outrank it: those tokens are finished, not one code away", async () => {
    expect(await membershipVerdict(recorderWith({ ...ALIVE, role: "admin", has_second_factor: true }).client, { ...ctx, aal: "aal1" })).toBe("stale");
    expect(await membershipVerdict(recorderWith({ ...ALIVE, has_second_factor: true, session_alive: false }).client, { ...ctx, aal: "aal1" })).toBe("signed_out");
  });

  it("is never cached, and the same session is current the moment its token is aal2", async () => {
    const row = { ...ALIVE, has_second_factor: true };
    expect(await membershipVerdict(recorderWith(row).client, { ...ctx, aal: "aal1" }, 1_000)).toBe("second_factor");
    expect(await membershipVerdict(recorderWith(row).client, { ...ctx, aal: "aal1" }, 1_001)).toBe("second_factor");
    expect(await membershipVerdict(recorderWith(row).client, { ...ctx, aal: "aal2" }, 1_002)).toBe("current");
    expect(reads).toBe(3);
  });

  it("a cached two-step answer is not served to a one-step token of the same session", async () => {
    const row = { ...ALIVE, has_second_factor: true };
    await membershipVerdict(recorderWith(row).client, { ...ctx, aal: "aal2" }, 1_000);
    expect(await membershipVerdict(recorderWith(row).client, { ...ctx, aal: "aal1" }, 1_001)).toBe("second_factor");
  });
});

describe("membershipVerdict — a database behind the code", () => {
  const missing = { error: { code: "PGRST202", message: "Could not find the function" } };

  it("without 0617 it asks 0616's function: membership and session still hold, and no second step is asked", async () => {
    const rec = createSupabaseRecorder({
      rpc: (fn) => (fn === "member_access_state" ? missing : fn === "member_token_state" ? [{ role: "admin", suspended_at: null, session_alive: false }] : undefined),
      tables: { memberships: () => { throw new Error("the table must not be read when a function answers"); } },
    });
    expect(await membershipVerdict(rec.client, { ...ctx, role: "admin" })).toBe("signed_out");
    const live = createSupabaseRecorder({ rpc: (fn) => (fn === "member_access_state" ? missing : [{ role: "admin", suspended_at: null, session_alive: true }]) });
    expect(await membershipVerdict(live.client, { ...ctx, role: "admin", aal: "aal1" })).toBe("current");
  });

  /** Neither function: the read SP7 shipped with answers, so the membership rule never lapses. */
  const without = (row: unknown, code = "PGRST202") =>
    createSupabaseRecorder({
      rpc: () => ({ error: { code, message: "Could not find the function" } }),
      tables: {
        memberships: (q: RecordedQuery) => {
          reads++;
          // Org AND user, or a same-user membership in another tenant would answer for this one.
          expect(q.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "user_id", val: USER }]));
          return { data: row === null ? [] : [row], error: null };
        },
      },
    });

  it("without either it still refuses a removed, suspended or re-roled membership", async () => {
    expect(await membershipVerdict(without(null).client, ctx)).toBe("stale");
    expect(await membershipVerdict(without({ role: "dispatcher", suspended_at: "2026-09-30T12:00:00Z" }).client, ctx)).toBe("stale");
    expect(await membershipVerdict(without({ role: "admin", suspended_at: null }, "42883").client, ctx)).toBe("stale");
    expect(reads).toBe(3);
  });

  it("...and lets a current membership through — the later rules simply wait for their migrations", async () => {
    expect(await membershipVerdict(without({ role: "dispatcher", suspended_at: null }).client, ctx)).toBe("current");
  });
});
