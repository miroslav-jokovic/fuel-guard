import { describe, expect, it } from "vitest";
import { attributionInstant, segmentAt } from "./duty.js";

/**
 * The two pure halves of per-stop attribution (LD5). The SQL rules — a segment closing with its
 * shift, a segment not predating it — are pinned in `supabase/tests/load-lifecycle.test.mjs` against
 * real Postgres. These are the matching rules, and they decide which truck a stop is attributed to.
 */

const seg = (from: string, to: string | null, vehicle: string) => ({
  vehicle_id: vehicle, trailer_id: null, seat: "driver", from_at: from, to_at: to,
});

// Newest first, the order the query returns.
const TIMELINE = [
  seg("2026-08-08T12:00:00Z", null, "truck-b"),
  seg("2026-08-08T06:00:00Z", "2026-08-08T12:00:00Z", "truck-a"),
];

describe("attributionInstant", () => {
  it("prefers completion over arrival — the equipment that matters is what did the work", () => {
    expect(attributionInstant({
      id: "s", arrived_at: "2026-08-08T09:00:00Z", completed_at: "2026-08-08T10:00:00Z",
    })).toBe("2026-08-08T10:00:00Z");
  });

  it("falls back to arrival for a stop the driver has reached but not finished", () => {
    expect(attributionInstant({ id: "s", arrived_at: "2026-08-08T09:00:00Z", completed_at: null }))
      .toBe("2026-08-08T09:00:00Z");
  });

  it("returns null for a stop nobody has worked", () => {
    // Falling back to "now" would attribute a future stop to whatever truck the driver is in today.
    expect(attributionInstant({ id: "s", arrived_at: null, completed_at: null })).toBeNull();
    expect(attributionInstant({ id: "s" })).toBeNull();
  });
});

describe("segmentAt", () => {
  it("finds the segment covering an instant", () => {
    expect(segmentAt(TIMELINE, "2026-08-08T08:00:00Z")?.vehicle_id).toBe("truck-a");
    expect(segmentAt(TIMELINE, "2026-08-08T14:00:00Z")?.vehicle_id).toBe("truck-b");
  });

  it("treats the handover instant as belonging to the NEW segment only", () => {
    // Half-open [from, to). At exactly 12:00 the driver is in truck B, not in both.
    expect(segmentAt(TIMELINE, "2026-08-08T12:00:00Z")?.vehicle_id).toBe("truck-b");
  });

  it("includes the first instant of a segment", () => {
    expect(segmentAt(TIMELINE, "2026-08-08T06:00:00Z")?.vehicle_id).toBe("truck-a");
  });

  it("returns null before the driver ever checked in", () => {
    expect(segmentAt(TIMELINE, "2026-08-07T23:00:00Z")).toBeNull();
  });

  it("keeps an open segment open indefinitely", () => {
    expect(segmentAt(TIMELINE, "2030-01-01T00:00:00Z")?.vehicle_id).toBe("truck-b");
  });

  it("respects a closed final segment — a signed-off shift attributes nothing after it", () => {
    const closed = [seg("2026-08-08T06:00:00Z", "2026-08-08T18:00:00Z", "truck-a")];
    expect(segmentAt(closed, "2026-08-08T19:00:00Z")).toBeNull();
  });

  it("returns null rather than throwing on an unparseable instant", () => {
    expect(segmentAt(TIMELINE, "not a date")).toBeNull();
  });

  it("returns null on an empty timeline", () => {
    expect(segmentAt([], "2026-08-08T08:00:00Z")).toBeNull();
  });
});
