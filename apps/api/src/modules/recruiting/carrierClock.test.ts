import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { carrierToday } from "./carrierClock.js";

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

/**
 * Today on the carrier's calendar (2026-10-20 audit).
 *
 * ⚠ The fixture's zone is Denver, never Chicago: CI runs on `America/Chicago`, so a mutant that read
 * the PROCESS's zone instead of the carrier's would pass a Chicago fixture (`calendarDay.ts`'s trap).
 * The instant is 23:30 in Denver on the 19th and already the 20th in UTC — the evening hour that
 * filed a handbook as signed tomorrow.
 */
const EVENING_IN_DENVER = new Date("2026-10-20T05:30:00Z");

describe("carrierToday", () => {
  it("is the carrier's day, not the UTC one", async () => {
    const rec = createSupabaseRecorder({ tables: { organizations: [{ operating_hours: { tz: "America/Denver" } }] } });
    expect(await carrierToday(rec.client, ORG, EVENING_IN_DENVER)).toBe("2026-10-19");
    expectOrgScoped(rec, ORG);
  });

  it("falls to the product's default zone when the org has not set one", async () => {
    // 03:00 UTC is 22:00 the evening before in Chicago, the default.
    const rec = createSupabaseRecorder({ tables: { organizations: [] } });
    expect(await carrierToday(rec.client, ORG, new Date("2026-10-20T03:00:00Z"))).toBe("2026-10-19");
  });
});
