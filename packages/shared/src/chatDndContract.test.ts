import { describe, expect, it } from "vitest";
import { chatDndPauseRequestSchema, chatDndScheduleRequestSchema, nextWallClock } from "./chatDndContract.js";

/**
 * "Until tomorrow morning" must land on 8:00 on the person's own clock — not the server's, and not an hour off
 * across a daylight-saving change — and the requests must refuse half a window and a window of nothing.
 */
describe("nextWallClock", () => {
  it("is tomorrow's 8:00 in the evening, in the person's zone", () => {
    // 2026-11-13 21:30 in Chicago (CST, UTC-6) → 2026-11-14 08:00 CST = 14:00Z.
    expect(nextWallClock(new Date("2026-11-14T03:30:00Z"), "America/Chicago", 8, 0).toISOString()).toBe("2026-11-14T14:00:00.000Z");
  });

  it("is today's 8:00 when it is still the small hours", () => {
    // 02:00 Chicago on the 14th → 08:00 the same day.
    expect(nextWallClock(new Date("2026-11-14T08:00:00Z"), "America/Chicago", 8, 0).toISOString()).toBe("2026-11-14T14:00:00.000Z");
  });

  it("is tomorrow's at 8:00 exactly — the next one, not this instant", () => {
    expect(nextWallClock(new Date("2026-11-14T14:00:00Z"), "America/Chicago", 8, 0).toISOString()).toBe("2026-11-15T14:00:00.000Z");
  });

  it("reads the offset at the answer: the night daylight saving ends", () => {
    // 2026-10-31 22:00 CDT (UTC-5) = 03:00Z Nov 1; clocks fall back at 2:00 on Nov 1, so 8:00 is CST = 14:00Z.
    expect(nextWallClock(new Date("2026-11-01T03:00:00Z"), "America/Chicago", 8, 0).toISOString()).toBe("2026-11-01T14:00:00.000Z");
  });

  it("works east of Greenwich across a date line in UTC", () => {
    // 23:00 in Belgrade (CET, UTC+1) on Nov 13 = 22:00Z → 08:00 CET Nov 14 = 07:00Z.
    expect(nextWallClock(new Date("2026-11-13T22:00:00Z"), "Europe/Belgrade", 8, 0).toISOString()).toBe("2026-11-14T07:00:00.000Z");
  });
});

describe("requests", () => {
  it("a pause is an instant with its offset, or null to resume", () => {
    expect(chatDndPauseRequestSchema.safeParse({ until: "2026-11-14T14:00:00.000Z" }).success).toBe(true);
    expect(chatDndPauseRequestSchema.safeParse({ until: null }).success).toBe(true);
    expect(chatDndPauseRequestSchema.safeParse({ until: "tomorrow" }).success).toBe(false);
  });

  it("a window is both times or neither, never one time to itself", () => {
    expect(chatDndScheduleRequestSchema.safeParse({ start: "22:00", end: "07:00", timezone: "America/Chicago" }).success).toBe(true);
    expect(chatDndScheduleRequestSchema.safeParse({ start: null, end: null, timezone: "UTC" }).success).toBe(true);
    expect(chatDndScheduleRequestSchema.safeParse({ start: "22:00", end: null, timezone: "UTC" }).success).toBe(false);
    expect(chatDndScheduleRequestSchema.safeParse({ start: "22:00", end: "22:00", timezone: "UTC" }).success).toBe(false);
    expect(chatDndScheduleRequestSchema.safeParse({ start: "25:00", end: "07:00", timezone: "UTC" }).success).toBe(false);
  });
});
