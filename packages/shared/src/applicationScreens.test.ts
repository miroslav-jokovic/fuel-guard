import { describe, expect, it } from "vitest";
import {
  APPLY_PHASE_SCREENS,
  APPLY_SCREENS,
  PART_ONE_SCREENS,
  SCREEN_EVENTS_MAX,
  applicationScreenEventsSchema,
  isApplyScreen,
  partOneScreenName,
} from "./applicationScreens.js";
import { APPLICATION_SECTION_ORDER } from "./applicationSections.js";
import { AUTHORIZATION_PURPOSES } from "./authorizationContract.js";

/** 0376's CHECK on `application_screen_events.screen`, copied from the migration. */
const DB_SCREEN_CHECK = /^[a-z0-9_.-]{1,60}$/;

const ID = "3f0c8a52-6d0e-4c7a-9b1e-2a4f5d6e7c8b";
const visit = (over: Record<string, unknown> = {}) => ({
  id: ID,
  screen: "part1.about",
  entered_at: "2026-09-28T15:00:00.000Z",
  left_at: "2026-09-28T15:01:30.000Z",
  ...over,
});
const report = (events: unknown[]) => ({ sent_at: "2026-09-28T15:02:00.000Z", events });

describe("the screen names", () => {
  it("every name fits 0376's CHECK, so no report is refused by the database for a name the page sent", () => {
    for (const name of APPLY_SCREENS) expect(name, name).toMatch(DB_SCREEN_CHECK);
  });

  it("snake-cases Part 1's camelCase screen, which the CHECK would refuse as-is", () => {
    expect(partOneScreenName("otherLicences")).toBe("part1.other_licences");
    expect(partOneScreenName("cdl_front")).toBe("part1.cdl_front");
    expect(isApplyScreen("part1.otherLicences")).toBe(false);
  });

  it("is derived from the lists the screens are: every Part 1 screen, section and permission has a name", () => {
    for (const s of PART_ONE_SCREENS) expect(APPLY_SCREENS).toContain(partOneScreenName(s));
    for (const s of APPLICATION_SECTION_ORDER) expect(APPLY_SCREENS).toContain(`part2.${s}`);
    for (const p of AUTHORIZATION_PURPOSES) expect(APPLY_SCREENS).toContain(`ceremony.${p}`);
    for (const p of APPLY_PHASE_SCREENS) expect(APPLY_SCREENS).toContain(p);
    expect(APPLY_SCREENS).toContain("part2.hub");
    expect(new Set(APPLY_SCREENS).size).toBe(APPLY_SCREENS.length);
  });

  it("accepts only its own names — a value shaped like a name is not one (D-APP16)", () => {
    expect(isApplyScreen("part1.about")).toBe(true);
    expect(isApplyScreen("dob-1990-01-01")).toBe(false);
    expect(isApplyScreen("part1.")).toBe(false);
    expect(isApplyScreen("part2.review.extra")).toBe(false);
  });
});

describe("applicationScreenEventsSchema", () => {
  it("takes an open visit and a closed one", () => {
    expect(applicationScreenEventsSchema.safeParse(report([visit(), visit({ left_at: null })])).success).toBe(true);
  });

  it("refuses a name that is not a screen, a visit left before it was entered, and a non-uuid id", () => {
    expect(applicationScreenEventsSchema.safeParse(report([visit({ screen: "dob-1990-01-01" })])).success).toBe(false);
    expect(
      applicationScreenEventsSchema.safeParse(report([visit({ left_at: "2026-09-28T14:59:59.000Z" })])).success,
    ).toBe(false);
    expect(applicationScreenEventsSchema.safeParse(report([visit({ id: "visit-1" })])).success).toBe(false);
  });

  it(`refuses an empty report and one of more than ${SCREEN_EVENTS_MAX} visits`, () => {
    expect(applicationScreenEventsSchema.safeParse(report([])).success).toBe(false);
    const full = Array.from({ length: SCREEN_EVENTS_MAX }, () => visit());
    expect(applicationScreenEventsSchema.safeParse(report(full)).success).toBe(true);
    expect(applicationScreenEventsSchema.safeParse(report([...full, visit()])).success).toBe(false);
  });
});
