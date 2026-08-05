import { describe, it, expect } from "vitest";
import {
  verifyFillAttribution,
  shouldReattribute,
  ATTRIBUTION_TIME_BUFFER_MS,
  type LogbookSegment,
} from "./fillAttribution.js";

const T0 = Date.parse("2026-08-05T10:00:00Z"); // the fueling instant
const H = 3_600_000;
const seg = (vehicleId: string | null, startMs: number, endMs: number | null): LogbookSegment => ({
  vehicleId,
  startMs,
  endMs,
});

describe("verifyFillAttribution (WP-ATTR — logbook vs attributed truck)", () => {
  it("confirmed when the logbook shows the attributed truck at the fueling instant", () => {
    const r = verifyFillAttribution("A", T0, [seg("A", T0 - 5 * H, null)]);
    expect(r).toEqual({ verdict: "confirmed", logbookVehicleId: null });
  });

  it("suspect when every in-buffer logbook segment shows a DIFFERENT truck", () => {
    const r = verifyFillAttribution("A", T0, [seg("B", T0 - 5 * H, T0 + 5 * H)]);
    expect(r.verdict).toBe("suspect");
    expect(r.logbookVehicleId).toBe("B");
  });

  it("mid-switch ambiguity never accuses: EITHER truck inside the buffer confirms (ELD login lag)", () => {
    // Driver fueled the new truck A at T0 but only logged into it 90 min later — old truck B covers T0.
    const segs = [seg("B", T0 - 8 * H, T0 + 1.5 * H), seg("A", T0 + 1.5 * H, null)];
    expect(verifyFillAttribution("A", T0, segs).verdict).toBe("confirmed");
    // …and the reverse (logged out of A shortly before fueling it) also confirms.
    const segs2 = [seg("A", T0 - 8 * H, T0 - 0.5 * H), seg("B", T0 - 0.5 * H, null)];
    expect(verifyFillAttribution("A", T0, segs2).verdict).toBe("confirmed");
  });

  it("unknown when there is no attributed vehicle, no segments, or no vehicle on the segments", () => {
    expect(verifyFillAttribution(null, T0, [seg("B", T0 - H, null)]).verdict).toBe("unknown");
    expect(verifyFillAttribution("A", T0, []).verdict).toBe("unknown");
    expect(verifyFillAttribution("A", T0, [seg(null, T0 - H, null)]).verdict).toBe("unknown");
  });

  it("segments entirely outside the buffer are ignored (yesterday's truck can't accuse today's fill)", () => {
    const stale = [seg("B", T0 - 30 * H, T0 - 20 * H)];
    expect(verifyFillAttribution("A", T0, stale).verdict).toBe("unknown");
    // …but a segment ending just inside the buffer counts.
    const inBuffer = [seg("B", T0 - 30 * H, T0 - ATTRIBUTION_TIME_BUFFER_MS + 60_000)];
    expect(verifyFillAttribution("A", T0, inBuffer).verdict).toBe("suspect");
  });

  it("suspect picks the segment COVERING the instant over a merely-nearby one", () => {
    const segs = [seg("C", T0 + H, null), seg("B", T0 - 5 * H, T0 + 0.5 * H)];
    expect(verifyFillAttribution("A", T0, segs).logbookVehicleId).toBe("B");
  });

  it("open segments (ended_at null) extend to now", () => {
    expect(verifyFillAttribution("A", T0, [seg("B", T0 - 24 * H, null)]).verdict).toBe("suspect");
  });
});

describe("shouldReattribute (logbook + GPS must BOTH contradict)", () => {
  const suspectB = { verdict: "suspect" as const, logbookVehicleId: "B" };
  it("suspect + attributed truck NOT at the station → re-attribute", () => {
    expect(shouldReattribute(suspectB, false)).toBe(true);
  });
  it("suspect alone is not enough — GPS unknown/matched never rewrites the record", () => {
    expect(shouldReattribute(suspectB, null)).toBe(false);
    expect(shouldReattribute(suspectB, undefined)).toBe(false);
    expect(shouldReattribute(suspectB, true)).toBe(false);
  });
  it("confirmed/unknown never re-attribute regardless of GPS", () => {
    expect(shouldReattribute({ verdict: "confirmed", logbookVehicleId: null }, false)).toBe(false);
    expect(shouldReattribute({ verdict: "unknown", logbookVehicleId: null }, false)).toBe(false);
  });
});
