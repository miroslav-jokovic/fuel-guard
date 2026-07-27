import { describe, expect, it } from "vitest";
import {
  badgeLabel,
  deepLinkFor,
  inQuietHours,
  isMutable,
  NOTIFICATION_CATEGORIES,
  notificationDayGroup,
  parseClock,
  suppressionReason,
  unreadCount,
  type NotificationEvent,
} from "./index.js";

const prefs = (over: Partial<{ muted_categories: string[]; quiet_hours_start: string | null; quiet_hours_end: string | null }> = {}) => ({
  muted_categories: [] as string[],
  quiet_hours_start: null as string | null,
  quiet_hours_end: null as string | null,
  ...over,
});

const at = (h: number, m = 0) => h * 60 + m;

describe("parseClock", () => {
  it("reads HH:MM into minutes past midnight", () => {
    expect(parseClock("00:00")).toBe(0);
    expect(parseClock("06:30")).toBe(390);
    expect(parseClock("23:59")).toBe(1439);
  });

  it("tolerates the seconds Postgres adds to a `time` column", () => {
    expect(parseClock("22:00:00")).toBe(1320);
  });

  it("rejects nonsense rather than guessing", () => {
    expect(parseClock(null)).toBeNull();
    expect(parseClock("")).toBeNull();
    expect(parseClock("25:00")).toBeNull();
    expect(parseClock("10:75")).toBeNull();
  });
});

describe("inQuietHours — the wrapping window is the normal case", () => {
  it("handles a window that crosses midnight (22:00 → 06:00)", () => {
    expect(inQuietHours(at(23), "22:00", "06:00")).toBe(true);
    expect(inQuietHours(at(2), "22:00", "06:00")).toBe(true);
    expect(inQuietHours(at(6), "22:00", "06:00")).toBe(false);
    expect(inQuietHours(at(12), "22:00", "06:00")).toBe(false);
  });

  it("handles a same-day window (13:00 → 15:00)", () => {
    expect(inQuietHours(at(14), "13:00", "15:00")).toBe(true);
    expect(inQuietHours(at(16), "13:00", "15:00")).toBe(false);
  });

  it("is half-open, so the end minute is already awake", () => {
    expect(inQuietHours(at(22), "22:00", "06:00")).toBe(true);
    expect(inQuietHours(at(6), "22:00", "06:00")).toBe(false);
  });

  it("treats a zero-width window as no quiet hours, not permanent silence", () => {
    expect(inQuietHours(at(3), "22:00", "22:00")).toBe(false);
  });

  it("is inactive when only one end is set — a half-configured window silences nothing", () => {
    expect(inQuietHours(at(3), "22:00", null)).toBe(false);
    expect(inQuietHours(at(3), null, "06:00")).toBe(false);
  });
});

describe("suppressionReason — and why it returns a reason, not a boolean", () => {
  it("delivers by default", () => {
    expect(suppressionReason("load_offered", "info", prefs(), at(9))).toBeNull();
  });

  it("names a mute so the settings screen can explain a missed load", () => {
    expect(
      suppressionReason("load_offered", "info", prefs({ muted_categories: ["load_offered"] }), at(9)),
    ).toBe("muted");
  });

  it("names quiet hours separately from a mute", () => {
    expect(
      suppressionReason("load_offered", "info", prefs({ quiet_hours_start: "22:00", quiet_hours_end: "06:00" }), at(2)),
    ).toBe("quiet_hours");
  });

  it("lets a CRITICAL notification through quiet hours — a canceled load beats a sleeping phone", () => {
    expect(
      suppressionReason("load_canceled", "critical", prefs({ quiet_hours_start: "22:00", quiet_hours_end: "06:00" }), at(2)),
    ).toBeNull();
  });

  it("refuses to let a driver mute a cancellation at all", () => {
    expect(isMutable("load_canceled")).toBe(false);
    expect(isMutable("system")).toBe(false);
    expect(isMutable("performance_week")).toBe(true);
    // Even with it in the muted list, a non-mutable category still delivers.
    expect(
      suppressionReason("load_canceled", "critical", prefs({ muted_categories: ["load_canceled"] }), at(9)),
    ).toBeNull();
  });

  it("still suppresses a MUTABLE category at critical severity if it was muted", () => {
    expect(
      suppressionReason("performance_week", "critical", prefs({ muted_categories: ["performance_week"] }), at(9)),
    ).toBe("muted");
  });
});

describe("deepLinkFor — a notification that lands on Home wasted its moment", () => {
  it("opens the exact load", () => {
    expect(deepLinkFor("load_offered", "abc")).toBe("/loads/abc");
    expect(deepLinkFor("load_canceled", "abc")).toBe("/loads/abc");
  });

  it("falls back to the list rather than nowhere when the entity is missing", () => {
    expect(deepLinkFor("load_offered", null)).toBe("/loads");
  });

  it("routes the non-entity categories somewhere sensible", () => {
    expect(deepLinkFor("performance_week", null)).toBe("/score");
    expect(deepLinkFor("duty_auto_closed", null)).toBe("/home");
  });

  it("covers every category without throwing", () => {
    for (const c of NOTIFICATION_CATEGORIES) {
      expect(() => deepLinkFor(c, "x")).not.toThrow();
    }
  });
});

describe("inbox derivations", () => {
  const ev = (over: Partial<NotificationEvent>): NotificationEvent => ({
    id: "00000000-0000-4000-8000-000000000001",
    category: "load_offered",
    title: "New load",
    body: null,
    severity: "info",
    entity_type: "load",
    entity_id: null,
    deep_link: null,
    created_at: "2026-07-27T09:00:00.000Z",
    read_at: null,
    ...over,
  });

  it("counts only what is unread", () => {
    expect(unreadCount([ev({}), ev({ read_at: "2026-07-27T10:00:00.000Z" }), ev({})])).toBe(2);
  });

  it("caps the badge so a bell never reads 1,284", () => {
    expect(badgeLabel(0)).toBeNull();
    expect(badgeLabel(7)).toBe("7");
    expect(badgeLabel(100)).toBe("99+");
  });

  it("groups by day the way a person reads a list", () => {
    const now = Date.parse("2026-07-27T12:00:00.000Z");
    expect(notificationDayGroup("2026-07-27T09:00:00.000Z", now)).toBe("Today");
    expect(notificationDayGroup("2026-07-26T23:00:00.000Z", now)).toBe("Yesterday");
    expect(notificationDayGroup("not-a-date", now)).toBe("Earlier");
  });
});
