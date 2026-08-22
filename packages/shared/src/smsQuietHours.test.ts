import { describe, it, expect } from "vitest";
import {
  SEND_WINDOW_END_HOUR,
  SEND_WINDOW_START_HOUR,
  canSendSmsAt,
} from "./smsQuietHours.js";

/**
 * Quiet hours (A11b, D-APP13).
 *
 * The tests are one-sided on purpose. A false negative holds a recruiting text for a few hours; a
 * false positive is a TCPA violation assessed at $500 to $1,500 per message. So what is pinned hardest
 * is not that messages go out — it is that they do not, whenever the answer is in any doubt.
 */

const at = (iso: string): Date => new Date(iso);

describe("when the recipient's timezone is known", () => {
  it("sends inside the window and holds outside it", () => {
    // 15:00 UTC is 10:00 in Chicago (CDT, UTC-5).
    expect(canSendSmsAt(at("2026-08-21T15:00:00Z"), "America/Chicago")).toBe(true);
    // 03:00 UTC is 22:00 the previous evening in Chicago — past our 20:00 cutoff.
    expect(canSendSmsAt(at("2026-08-21T03:00:00Z"), "America/Chicago")).toBe(false);
    // 12:00 UTC is 07:00 in Chicago — before our 09:00 start.
    expect(canSendSmsAt(at("2026-08-21T12:00:00Z"), "America/Chicago")).toBe(false);
  });

  it("holds at the boundaries rather than sending on them", () => {
    // Exactly 20:00 local is OUT — the window is half-open, and the hour we chose is already an hour
    // tighter than §64.1200(c)(1)'s 21:00.
    expect(canSendSmsAt(at("2026-08-22T01:00:00Z"), "America/Chicago")).toBe(false);
    // Exactly 09:00 local is IN.
    expect(canSendSmsAt(at("2026-08-21T14:00:00Z"), "America/Chicago")).toBe(true);
  });

  /** A zone string from a config file somebody mistyped must not read as permission. */
  it("falls back to the strict window for a zone it cannot read", () => {
    // 12:00 UTC is 07:00 Central — outside the all-US window too, so an unusable zone holds.
    expect(canSendSmsAt(at("2026-08-21T12:00:00Z"), "Mars/Olympus_Mons")).toBe(false);
  });
});

describe("when it is not known — which is the normal case", () => {
  /**
   * ⚠ The property the whole design rests on. With no timezone there is no safe default answer to
   * "is it a civil hour for this person", so the only honest one is to require that it be a civil hour
   * for everybody from Hawaii to Eastern.
   */
  it("sends only when the hour is civil in every US timezone at once", () => {
    // 20:00 UTC — 16:00 Eastern, 10:00 Hawaii. Civil everywhere.
    expect(canSendSmsAt(at("2026-08-21T20:00:00Z"), null)).toBe(true);

    // 18:00 UTC — 14:00 Eastern, but 08:00 in Hawaii. One timezone is enough to hold it.
    expect(canSendSmsAt(at("2026-08-21T18:00:00Z"), null)).toBe(false);

    // 00:30 UTC — 20:30 Eastern, past our cutoff there even though Hawaii is mid-afternoon.
    expect(canSendSmsAt(at("2026-08-22T00:30:00Z"), null)).toBe(false);

    // The dead of night everywhere.
    expect(canSendSmsAt(at("2026-08-21T08:00:00Z"), null)).toBe(false);
  });

  it("is undefined-safe, because an absent column and a null one mean the same thing", () => {
    expect(canSendSmsAt(at("2026-08-21T20:00:00Z"), undefined)).toBe(true);
    expect(canSendSmsAt(at("2026-08-21T08:00:00Z"), undefined)).toBe(false);
  });

  /**
   * The window is narrow, and that is the trade being made rather than a bug: a nudge is sent once per
   * driver in their lifetime, and the sweep that produces it runs every six hours.
   */
  it("leaves a usable window every day, so a held message is not a lost one", () => {
    const sendable = Array.from({ length: 24 }, (_, h) =>
      canSendSmsAt(at(`2026-08-21T${String(h).padStart(2, "0")}:00:00Z`), null),
    ).filter(Boolean).length;
    expect(sendable).toBeGreaterThanOrEqual(4);
    // And it is genuinely a restriction — if this ever passed for most of the day, the fallback has
    // stopped being strict.
    expect(sendable).toBeLessThan(12);
  });
});

describe("the window itself", () => {
  /** Ours, not the regulation's. §64.1200(c)(1) permits 8–21; the extra hour each side is a margin. */
  it("is tighter than the CFR at both ends", () => {
    expect(SEND_WINDOW_START_HOUR).toBeGreaterThan(8);
    expect(SEND_WINDOW_END_HOUR).toBeLessThan(21);
  });
});
