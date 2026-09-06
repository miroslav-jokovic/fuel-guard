import { describe, it, expect } from "vitest";
import { describeFeedFreshness, FEED_LATE_AFTER_PASSES, type FeedState } from "./feedFreshness.js";

/**
 * FUEL-T5 / A7 — a page of vendor rows says when it last heard from the vendor.
 *
 * Transactions and Rejections render EFS's own records verbatim, so the only way either can be wrong
 * is by being INCOMPLETE — and a poller that stopped looks exactly like a quiet week. The fuel-drop
 * webhook that received nothing for six months was the same failure in a different feed.
 */

const NOW = new Date("2026-09-02T12:00:00Z");
const minsAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();
const state = (o: Partial<FeedState> = {}): FeedState =>
  ({ lastSuccessAt: null, lastPolledAt: null, lastError: null, ...o });

describe("describeFeedFreshness — a stopped poller must not read as a quiet week", () => {
  it("says when the feed last DELIVERED, in the reader's units", () => {
    const at = (m: number) => describeFeedFreshness("posted", state({ lastSuccessAt: minsAgo(m), lastPolledAt: minsAgo(m) }), 15, NOW).lead;
    expect(at(0)).toContain("just now");
    expect(at(1)).toContain("1 minute ago");
    expect(at(7)).toContain("7 minutes ago");
    expect(at(90)).toContain("1 hour ago");
    expect(at(60 * 50)).toContain("2 days ago");
  });

  // ⚠ THE ASSERTION THIS MODULE EXISTS FOR. `recordFeedFailure` stamps `*_last_polled_at` on failure
  // too, so a feed refused for two days still carries a poll stamp from three minutes ago. Reading the
  // poll stamp — which is the column the plan named — would print "arrived 3 minutes ago" while
  // nothing had arrived at all.
  it("reads the SUCCESS stamp, never the poll stamp — a failing feed is polled constantly", () => {
    const r = describeFeedFreshness("posted", state({
      lastSuccessAt: minsAgo(60 * 48), // two days since anything arrived
      lastPolledAt: minsAgo(3),        // …but we tried three minutes ago
      lastError: "SOAP fault: invalid credentials",
    }), 15, NOW);
    expect(r.lead).not.toContain("3 minutes ago");
    expect(r.lead).toContain("2 days ago");
    expect(r.ageMinutes).toBe(60 * 48);
  });

  it("calls a refused feed FAILING rather than late — one needs a fix, the other needs patience", () => {
    const r = describeFeedFreshness("rejected", state({
      lastSuccessAt: minsAgo(4), lastPolledAt: minsAgo(1), lastError: "certificate expired",
    }), 5, NOW);
    // Four minutes old is well inside the cadence, so age alone would have called this healthy.
    expect(r).toMatchObject({ failing: true, late: false, needsAttention: true });
    expect(r.lead).toContain("refusing this feed");
  });

  it("distinguishes never-collected from late, because they need different actions", () => {
    const r = describeFeedFreshness("rejected", state(), 5, NOW);
    expect(r).toMatchObject({ neverCollected: true, late: false, failing: false, ageMinutes: null });
    expect(r.lead).toContain("never been collected");
    expect(r.lead).toContain("empty rather than quiet");
  });

  it("separates 'the vendor had nothing to send' from 'we never asked'", () => {
    // Polled, no error, no success: EFS answered and there was nothing. That is a working feed.
    const r = describeFeedFreshness("posted", state({ lastPolledAt: minsAgo(2) }), 15, NOW);
    expect(r).toMatchObject({ neverCollected: false, failing: false, late: false, needsAttention: false });
    expect(r.lead).toContain("has not sent any yet");
  });

  // The threshold is a multiple of the interval the poller PROMISES, not a round number.
  it("scales 'late' to each feed's own cadence rather than to a fixed period", () => {
    const s = state({ lastSuccessAt: minsAgo(40), lastPolledAt: minsAgo(1) });
    expect(describeFeedFreshness("posted", s, 15, NOW).late).toBe(false); // under 3 x 15
    expect(describeFeedFreshness("rejected", s, 5, NOW).late).toBe(true); // over 3 x 5
  });

  it("is late strictly PAST the allowance, not at it — one slow pass is not an outage", () => {
    const exact = FEED_LATE_AFTER_PASSES * 15;
    const s = (m: number) => state({ lastSuccessAt: minsAgo(m), lastPolledAt: minsAgo(1) });
    expect(describeFeedFreshness("posted", s(exact), 15, NOW).late).toBe(false);
    expect(describeFeedFreshness("posted", s(exact + 1), 15, NOW).late).toBe(true);
  });

  it("tells the reader what a late feed means for the list they are looking at", () => {
    const r = describeFeedFreshness("posted", state({ lastSuccessAt: minsAgo(300), lastPolledAt: minsAgo(1) }), 15, NOW);
    // Not "the feed is late" — what an operator needs is what that does to the rows on screen.
    expect(r.lead).toContain("missing from this list rather than absent from the fleet");
    expect(r.lead).toContain("every 15 minutes");
  });

  it("names the two feeds in the reader's words, not the vendor's", () => {
    const s = state({ lastSuccessAt: minsAgo(5), lastPolledAt: minsAgo(5) });
    expect(describeFeedFreshness("posted", s, 15, NOW).lead).toContain("Completed fuel purchases");
    expect(describeFeedFreshness("rejected", s, 5, NOW).lead).toContain("Declined card attempts");
  });

  it("never reports a negative age when a stamp is ahead of the clock", () => {
    const ahead = new Date(NOW.getTime() + 60_000).toISOString();
    const r = describeFeedFreshness("posted", state({ lastSuccessAt: ahead, lastPolledAt: ahead }), 15, NOW);
    expect(r.ageMinutes).toBe(0);
    expect(r.late).toBe(false);
  });

  it("ignores an unparseable stamp rather than treating it as ancient", () => {
    const r = describeFeedFreshness("posted", state({ lastSuccessAt: "nonsense", lastPolledAt: minsAgo(2) }), 15, NOW);
    expect(r.ageMinutes).toBeNull();
    expect(r.neverCollected).toBe(false); // it HAS been polled; only the success stamp is unreadable
  });
});
