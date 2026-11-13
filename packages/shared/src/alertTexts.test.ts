import { describe, expect, it } from "vitest";
import {
  ALERT_TEXT_MAX,
  ALERT_TEXT_QUIET_DEFAULT,
  alertContactState,
  alertPhoneConfirmSchema,
  alertPhoneStartSchema,
  alertTextBody,
  alertTextClock,
  alertTextClockMinutes,
  alertTextClockValue,
  alertTextNotBefore,
  alertTextQuietSchema,
  inAlertTextQuiet,
} from "./alertTexts.js";

const CHI = "America/Chicago";
// 2026-11-13 is CST (UTC-6).
const central = (hhmm: string, day = "2026-11-13") => new Date(`${day}T${hhmm}:00-06:00`);

describe("the hours a text waits (D-HT18)", () => {
  it("holds from 21:00 to 07:00 on the carrier's clock, both ends exact", () => {
    const q = ALERT_TEXT_QUIET_DEFAULT;
    expect(inAlertTextQuiet(central("20:59"), CHI, q)).toBe(false);
    expect(inAlertTextQuiet(central("21:00"), CHI, q)).toBe(true);
    expect(inAlertTextQuiet(central("02:30"), CHI, q)).toBe(true);
    expect(inAlertTextQuiet(central("06:59"), CHI, q)).toBe(true);
    expect(inAlertTextQuiet(central("07:00"), CHI, q)).toBe(false);
  });

  it("measures on the carrier's clock, not the server's", () => {
    // 03:30 UTC is 21:30 in Chicago and 19:30 in Los Angeles.
    const at = new Date("2026-11-14T03:30:00Z");
    expect(inAlertTextQuiet(at, CHI, ALERT_TEXT_QUIET_DEFAULT)).toBe(true);
    expect(inAlertTextQuiet(at, "America/Los_Angeles", ALERT_TEXT_QUIET_DEFAULT)).toBe(false);
  });

  it("handles a window that does not wrap midnight", () => {
    const q = { startMin: 60, endMin: 300 };
    expect(inAlertTextQuiet(central("00:30"), CHI, q)).toBe(false);
    expect(inAlertTextQuiet(central("03:00"), CHI, q)).toBe(true);
    expect(inAlertTextQuiet(central("05:00"), CHI, q)).toBe(false);
  });

  it("sends now outside the window, and at the window's end from inside it — the same night or the next morning", () => {
    const q = ALERT_TEXT_QUIET_DEFAULT;
    expect(alertTextNotBefore(central("14:00"), CHI, q)).toBeNull();
    expect(alertTextNotBefore(central("22:15"), CHI, q)!.toISOString()).toBe(central("07:00", "2026-11-14").toISOString());
    expect(alertTextNotBefore(central("05:40"), CHI, q)!.toISOString()).toBe(central("07:00").toISOString());
  });

  it("refuses a window whose ends are the same, and a minute that is not on a clock", () => {
    expect(alertTextQuietSchema.safeParse({ startMin: 420, endMin: 420 }).success).toBe(false);
    expect(alertTextQuietSchema.safeParse({ startMin: 1440, endMin: 0 }).success).toBe(false);
    expect(alertTextQuietSchema.safeParse(ALERT_TEXT_QUIET_DEFAULT).success).toBe(true);
  });

  it("words and round-trips a minute of the day", () => {
    expect(alertTextClock(21 * 60)).toBe("9:00 PM");
    expect(alertTextClock(7 * 60)).toBe("7:00 AM");
    expect(alertTextClock(0)).toBe("12:00 AM");
    expect(alertTextClock(12 * 60 + 5)).toBe("12:05 PM");
    expect(alertTextClockMinutes(alertTextClockValue(1290))).toBe(1290);
    expect(alertTextClockMinutes("24:00")).toBeNull();
    expect(alertTextClockMinutes("7:00")).toBeNull();
  });
});

describe("the words of a text (D-HT16)", () => {
  it("says who it is from, the alert, the sentence, and how to stop", () => {
    expect(alertTextBody("Home time overstayed", ["Marcus Hill (truck 702) is past his home-time return of 11/13/2026 4:00 AM and is not marked back"])).toBe(
      "Silvicom 360: Home time overstayed. Marcus Hill (truck 702) is past his home-time return of 11/13/2026 4:00 AM and is not marked back. Reply STOP to end.",
    );
  });

  it("puts everything new in ONE text", () => {
    const body = alertTextBody("Home time ending", ["A is due back.", "B is due back."]);
    expect(body).toBe("Silvicom 360: Home time ending. A is due back. B is due back. Reply STOP to end.");
  });

  it("never runs past two segments: it cuts whole sentences and says how many it left out, keeping the opt-out", () => {
    const lines = Array.from({ length: 12 }, (_, i) => `Driver Number ${i} (truck 70${i}) is past his home-time return and is not marked back`);
    const body = alertTextBody("Home time overstayed", lines);
    expect(body.length).toBeLessThanOrEqual(ALERT_TEXT_MAX);
    expect(body.endsWith("Reply STOP to end.")).toBe(true);
    const kept = (body.match(/Driver Number/g) ?? []).length;
    expect(kept).toBeGreaterThan(0);
    expect(body).toContain(`+${12 - kept} more.`);
  });

  it("always sends the first sentence, however long", () => {
    const body = alertTextBody("X", ["y".repeat(400)]);
    expect(body).toContain("y".repeat(400));
    expect(body).not.toContain("more.");
  });
});

describe("confirming the number (D-HT17)", () => {
  it("needs the agreement as a literal yes, and six digits", () => {
    expect(alertPhoneStartSchema.safeParse({ phone: "708 555 0100", agreed: true }).success).toBe(true);
    expect(alertPhoneStartSchema.safeParse({ phone: "708 555 0100", agreed: false }).success).toBe(false);
    expect(alertPhoneStartSchema.safeParse({ phone: "708 555 0100" }).success).toBe(false);
    expect(alertPhoneConfirmSchema.safeParse({ code: "012345" }).success).toBe(true);
    for (const code of ["12345", "1234567", "12345a", ""]) expect(alertPhoneConfirmSchema.safeParse({ code }).success, code).toBe(false);
  });

  it("reads where a person's texts stand from the row", () => {
    const row = (o: Partial<{ verified_at: string | null; stopped_at: string | null; code_hash: string | null }>) => ({ verified_at: null, stopped_at: null, code_hash: null, ...o });
    expect(alertContactState(null)).toBe("none");
    expect(alertContactState(row({}))).toBe("none");
    expect(alertContactState(row({ code_hash: "h" }))).toBe("pending");
    expect(alertContactState(row({ verified_at: "t" }))).toBe("verified");
    expect(alertContactState(row({ verified_at: "t", stopped_at: "t" }))).toBe("stopped");
    // A new code asked for by somebody already confirmed, or stopped: the code is what is waited for.
    expect(alertContactState(row({ verified_at: "t", stopped_at: "t", code_hash: "h" }))).toBe("pending");
  });
});
