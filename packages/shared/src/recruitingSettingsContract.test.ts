import { describe, expect, it } from "vitest";
import { INVITE_TTL_DAYS_DEFAULT, INVITE_TTL_DAYS_MAX, applicationInviteCreateSchema } from "./applicationIntake.js";
import { STALE_DRAFT_HOURS } from "./applicationNudge.js";
import {
  RECRUITING_SETTINGS_DEFAULTS,
  REMINDER_AFTER_HOURS_MAX,
  REMINDER_AFTER_HOURS_MIN,
  recruitingSettingsSchema,
} from "./recruitingSettingsContract.js";

/** The carrier's link lifetime and reminder (Q-AW41, S2). The database's twin is 0379's matrix. */
const ok = (v: object) => recruitingSettingsSchema.safeParse({ ...RECRUITING_SETTINGS_DEFAULTS, ...v }).success;

describe("the defaults", () => {
  it("are the shared constants, not a restatement of them", () => {
    expect(RECRUITING_SETTINGS_DEFAULTS).toEqual({
      invite_ttl_days: INVITE_TTL_DAYS_DEFAULT,
      reminders_enabled: true,
      reminder_after_hours: STALE_DRAFT_HOURS,
    });
    expect(recruitingSettingsSchema.safeParse(RECRUITING_SETTINGS_DEFAULTS).success).toBe(true);
  });
});

describe("the bounds", () => {
  it("takes a link of 1 to INVITE_TTL_DAYS_MAX days, whole days only", () => {
    expect(ok({ invite_ttl_days: 1, reminders_enabled: false })).toBe(true);
    expect(ok({ invite_ttl_days: INVITE_TTL_DAYS_MAX })).toBe(true);
    expect(ok({ invite_ttl_days: 0 })).toBe(false);
    expect(ok({ invite_ttl_days: INVITE_TTL_DAYS_MAX + 1 })).toBe(false);
    expect(ok({ invite_ttl_days: 2.5 })).toBe(false);
  });

  it("takes a reminder of REMINDER_AFTER_HOURS_MIN to _MAX hours", () => {
    expect(ok({ reminder_after_hours: REMINDER_AFTER_HOURS_MIN })).toBe(true);
    expect(ok({ reminder_after_hours: REMINDER_AFTER_HOURS_MIN - 1 })).toBe(false);
    expect(ok({ invite_ttl_days: 60, reminders_enabled: false, reminder_after_hours: REMINDER_AFTER_HOURS_MAX })).toBe(true);
    expect(ok({ invite_ttl_days: 60, reminders_enabled: false, reminder_after_hours: REMINDER_AFTER_HOURS_MAX + 1 })).toBe(false);
  });

  it("refuses a reminder that is on and would come as the link dies or later, with a sentence for a person", () => {
    const r = recruitingSettingsSchema.safeParse({ invite_ttl_days: 2, reminders_enabled: true, reminder_after_hours: 48 });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]).toMatchObject({ path: ["reminder_after_hours"] });
    expect(r.error!.issues[0]!.message).toMatch(/^The reminder must go before the link expires/);
    expect(ok({ invite_ttl_days: 2, reminder_after_hours: 47 })).toBe(true);
    expect(ok({ invite_ttl_days: 2, reminders_enabled: false, reminder_after_hours: 48 })).toBe(true);
  });

  it("refuses a partial set", () => {
    expect(recruitingSettingsSchema.safeParse({ invite_ttl_days: 7 }).success).toBe(false);
  });
});

describe("the invite's own override", () => {
  it("has no default of its own, so an absent value means the carrier's setting", () => {
    const parsed = applicationInviteCreateSchema.parse({ driver_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7" });
    expect("expires_in_days" in parsed && parsed.expires_in_days !== undefined).toBe(false);
  });
});
