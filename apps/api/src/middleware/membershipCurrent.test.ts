import { describe, expect, it, beforeEach, vi } from "vitest";
import { createSupabaseRecorder } from "../testing/supabaseRecorder.js";
import { membershipVerdict, forgetMembership, resetMembershipCache, MEMBERSHIP_CACHE_MS } from "./membershipCurrent.js";

/**
 * SP7 (Q-SET6 (a)): a signed token whose membership was removed, re-roled or suspended since is
 * refused by the API, not honoured until it expires. And Q-IA10 (0616): so is one whose session was
 * ended — the device was signed out. Each case is one way the old token outlived what it was minted from.
 * And IA-S1 rev 2 (0662, Q-IA20): so is an office token whose DEVICE has not given its emailed code in the
 * last week. The read is `member_access_gate`, executed by `supabase/tests/two-step-email-codes.test.mjs`
 * (and its device half, carried from 0620, by `member-devices.test.mjs`); the rule is `twoStepRequired` /
 * `twoStepSatisfied` in shared; this file holds the API to what it ASKS and what it makes of each answer.
 */
const ORG = "00000000-0000-4000-8000-00000000000a";
const USER = "00000000-0000-4000-8000-000000000002";
const SESSION = "5e551011-0000-4000-8000-000000000001";
const OTHER_SESSION = "5e551011-0000-4000-8000-000000000002";
const ctx = { userId: USER, orgId: ORG, role: "dispatcher" as const, sessionId: SESSION };

let reads = 0;
let asked: Array<Record<string, unknown>> = [];
/** The database with 0662: every answer comes from `member_access_gate`. `row` null = no membership. */
const recorderWith = (row: unknown, error: unknown = null) =>
  createSupabaseRecorder({
    rpc: (fn, args) => {
      if (fn !== "member_access_gate") return undefined;
      reads++;
      asked.push(args as Record<string, unknown>);
      return error ? { error } : row === null ? [] : [row];
    },
    tables: { memberships: () => { throw new Error("the table must not be read when the function answers"); } },
  });
const DAY = 86_400_000;
// The real clock: cases that pass no `now` read it too, so a fixed date here would rot in a week.
const NOW = Date.now();
const daysAgo = (d: number) => new Date(NOW - d * DAY).toISOString();
/** This device gave its code yesterday: the ordinary state of an office member at work. */
const ALIVE = { role: "dispatcher", suspended_at: null, session_alive: true, two_step_at: daysAgo(1) };
const ARGS = { p_device_key: null, p_limit: 3, p_idle_hours: 12, p_two_step_days: 7, p_two_step_required: true };

beforeEach(() => {
  resetMembershipCache();
  reads = 0;
  asked = [];
});

describe("membershipVerdict — the membership", () => {
  it("a membership with the token's role, not suspended, on a live session, is current", async () => {
    expect(await membershipVerdict(recorderWith(ALIVE).client, ctx, NOW)).toBe("current");
    // Org, person and session come from the token; one call, nothing else.
    expect(asked).toEqual([{ p_org: ORG, p_user: USER, p_session: SESSION, ...ARGS }]);
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
    expect(await membershipVerdict(recorderWith({ ...ALIVE, session_alive: null }).client, { ...ctx, sessionId: null }, NOW)).toBe("current");
    expect(asked).toEqual([{ p_org: ORG, p_user: USER, p_session: null, ...ARGS }]);
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

describe("membershipVerdict — the emailed code (IA-S1 rev 2, Q-IA20)", () => {
  it("a device that never gave its code owes it — any office role", async () => {
    for (const role of ["dispatcher", "admin", "accountant"] as const) {
      resetMembershipCache();
      expect(await membershipVerdict(recorderWith({ ...ALIVE, role, two_step_at: null }).client, { ...ctx, role }, NOW), role).toBe("second_factor");
    }
  });

  it("is current for six days and 23 hours, and owes it again at seven", async () => {
    expect(await membershipVerdict(recorderWith({ ...ALIVE, two_step_at: daysAgo(6.99) }).client, ctx, NOW)).toBe("current");
    resetMembershipCache();
    expect(await membershipVerdict(recorderWith({ ...ALIVE, two_step_at: daysAgo(7) }).client, ctx, NOW)).toBe("second_factor");
  });

  it("a driver is not asked, and the database is told so", async () => {
    const driver = { ...ctx, role: "driver" as const };
    expect(await membershipVerdict(recorderWith({ ...ALIVE, role: "driver", two_step_at: null }).client, driver, NOW)).toBe("current");
    expect(asked[0]!.p_two_step_required).toBe(false);
  });

  it("a removed membership and a signed-out device outrank it: those tokens are finished, not one code away", async () => {
    expect(await membershipVerdict(recorderWith({ ...ALIVE, role: "admin", two_step_at: null }).client, ctx, NOW)).toBe("stale");
    expect(await membershipVerdict(recorderWith({ ...ALIVE, two_step_at: null, session_alive: false }).client, ctx, NOW)).toBe("signed_out");
  });

  it("an owed answer is never cached: the request after the code is let in", async () => {
    expect(await membershipVerdict(recorderWith({ ...ALIVE, two_step_at: null }).client, ctx, NOW)).toBe("second_factor");
    expect(await membershipVerdict(recorderWith(ALIVE).client, ctx, NOW + 1)).toBe("current");
    expect(reads).toBe(2);
  });

  it("one device's cached answer is never served to another device on the same session", async () => {
    await membershipVerdict(recorderWith(ALIVE).client, { ...ctx, deviceKey: "the-office-pc-in-dispatch" }, NOW);
    expect(
      await membershipVerdict(recorderWith({ ...ALIVE, two_step_at: null }).client, { ...ctx, deviceKey: "somebody-elses-laptop-key" }, NOW + 1),
    ).toBe("second_factor");
  });

  it("the week runs out mid-session within one cache period", async () => {
    const row = { ...ALIVE, two_step_at: new Date(NOW - 7 * DAY + 1_000).toISOString() }; // a second left
    expect(await membershipVerdict(recorderWith(row).client, ctx, NOW)).toBe("current");
    expect(await membershipVerdict(recorderWith(row).client, ctx, NOW + MEMBERSHIP_CACHE_MS)).toBe("second_factor");
  });
});

describe("membershipVerdict — the device (IA-S6, 0620)", () => {
  const DEVICE = "the-office-pc-in-dispatch";

  it("passes the app's device key and the owner's limit of three (Q-IA16)", async () => {
    await membershipVerdict(recorderWith(ALIVE).client, { ...ctx, deviceKey: DEVICE });
    expect(asked).toEqual([{ p_org: ORG, p_user: USER, p_session: SESSION, ...ARGS, p_device_key: DEVICE }]);
  });

  it("never sends the database a key outside the app's alphabet", async () => {
    for (const bad of ["short", "x".repeat(65), "'; drop table x; --", "", "0123456789abcdef0123456789abcde\n"]) {
      resetMembershipCache();
      asked = [];
      await membershipVerdict(recorderWith(ALIVE).client, { ...ctx, deviceKey: bad });
      expect(asked[0]!.p_device_key).toBeNull();
    }
  });

  it("a fourth device is device_limit, and that answer is never cached — one signed out, and it is let in", async () => {
    expect(await membershipVerdict(recorderWith({ ...ALIVE, device_admitted: false, devices_in_use: 3 }).client, ctx, 1_000)).toBe("device_limit");
    expect(await membershipVerdict(recorderWith({ ...ALIVE, device_admitted: true, devices_in_use: 3 }).client, ctx, 1_001)).toBe("current");
  });

  it("nothing decided is not a refusal: no session named, or one still owing its code", async () => {
    expect(await membershipVerdict(recorderWith({ ...ALIVE, session_alive: null, device_admitted: null }).client, { ...ctx, sessionId: null })).toBe("current");
  });

  it("a changed membership, an ended session and an owed code each outrank the device limit", async () => {
    const over = { ...ALIVE, device_admitted: false };
    expect(await membershipVerdict(recorderWith({ ...over, role: "admin" }).client, ctx)).toBe("stale");
    expect(await membershipVerdict(recorderWith({ ...over, session_alive: false }).client, ctx)).toBe("signed_out");
    expect(await membershipVerdict(recorderWith({ ...over, two_step_at: null }).client, ctx, NOW)).toBe("second_factor");
  });
});

describe("membershipVerdict — a database behind the code", () => {
  it("a database without 0662 is a failed read: answered current, logged, not cached — and nothing older is asked", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const without = createSupabaseRecorder({
      rpc: (fn) => {
        if (fn === "member_access_gate") return { error: { code: "PGRST202", message: "Could not find the function" } };
        throw new Error(`asked ${fn}: there is no fallback (the reader merged after 0662 was applied)`);
      },
    });
    expect(await membershipVerdict(without.client, ctx, 1_000)).toBe("current");
    expect(await membershipVerdict(recorderWith(null).client, ctx, 1_001)).toBe("stale");
  });
});
