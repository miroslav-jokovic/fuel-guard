import { describe, expect, it } from "vitest";
import {
  loadBucket,
  loadSchema,
  missingPhotoSlots,
  nextStop,
  photoSlotLabel,
  stopPhotoPath,
  stopProgress,
  type LoadStop,
} from "./index.js";

function stop(over: Partial<LoadStop> = {}): LoadStop {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    seq: 1,
    kind: "pickup",
    name: "Shipper",
    address_line: null,
    city: null,
    state: null,
    postal_code: null,
    lat: null,
    lon: null,
    appointment_start: null,
    appointment_end: null,
    status: "pending",
    arrived_at: null,
    completed_at: null,
    required_photos: [],
    skip_reason: null,
    notes: null,
    photos: [],
    ...over,
  };
}

describe("loadBucket", () => {
  it("groups statuses into the app's three tabs", () => {
    expect(loadBucket("offered")).toBe("upcoming");
    expect(loadBucket("accepted")).toBe("upcoming");
    expect(loadBucket("in_transit")).toBe("current");
    expect(loadBucket("delivered")).toBe("previous");
    expect(loadBucket("canceled")).toBe("previous");
  });
});

describe("nextStop", () => {
  it("returns the lowest-seq unfinished stop", () => {
    const load = {
      stops: [
        stop({ id: "a", seq: 1, status: "completed" }),
        stop({ id: "b", seq: 2, status: "pending" }),
        stop({ id: "c", seq: 3, status: "pending" }),
      ],
    };
    expect(nextStop(load)?.id).toBe("b");
  });

  it("treats a skipped stop as finished", () => {
    const load = {
      stops: [stop({ id: "a", seq: 1, status: "skipped" }), stop({ id: "b", seq: 2, status: "arrived" })],
    };
    expect(nextStop(load)?.id).toBe("b");
  });

  it("returns null once every stop is done", () => {
    expect(nextStop({ stops: [stop({ status: "completed" })] })).toBeNull();
  });

  it("is order-independent (data may arrive unsorted)", () => {
    const load = {
      stops: [stop({ id: "c", seq: 3 }), stop({ id: "a", seq: 1 }), stop({ id: "b", seq: 2 })],
    };
    expect(nextStop(load)?.id).toBe("a");
  });
});

describe("stopProgress", () => {
  it("counts the stop being worked on, not the one finished", () => {
    expect(stopProgress({ stops: [stop({ status: "completed" }), stop(), stop()] })).toEqual({
      current: 2,
      total: 3,
    });
  });

  it("clamps to the total when everything is done", () => {
    expect(
      stopProgress({ stops: [stop({ status: "completed" }), stop({ status: "completed" })] }),
    ).toEqual({ current: 2, total: 2 });
  });

  it("does not divide by zero on a stopless load", () => {
    expect(stopProgress({ stops: [] })).toEqual({ current: 1, total: 0 });
  });
});

describe("missingPhotoSlots", () => {
  it("lists required slots with no capture yet", () => {
    const s = stop({
      required_photos: ["trailer", "seal", "bol"],
      photos: [
        { id: "p1", slot: "trailer", storage_path: "x", captured_at: null, uploaded_at: "now" },
      ],
    });
    expect(missingPhotoSlots(s)).toEqual(["seal", "bol"]);
  });

  it("is empty when the checklist is satisfied", () => {
    const s = stop({
      required_photos: ["bol"],
      photos: [{ id: "p", slot: "bol", storage_path: "x", captured_at: null, uploaded_at: "now" }],
    });
    expect(missingPhotoSlots(s)).toEqual([]);
  });

  it("ignores extra photos that satisfy no requirement", () => {
    const s = stop({
      required_photos: [],
      photos: [{ id: "p", slot: "damage", storage_path: "x", captured_at: null, uploaded_at: "now" }],
    });
    expect(missingPhotoSlots(s)).toEqual([]);
  });
});

describe("stopPhotoPath", () => {
  it("matches the storage RLS layout: org / driver / load / photo", () => {
    expect(stopPhotoPath("org1", "drv1", "load1", "photo1")).toBe("org1/drv1/load1/photo1.webp");
    // Segment 1 = tenant isolation, segment 2 = driver isolation (migration 0085).
    const parts = stopPhotoPath("org1", "drv1", "load1", "photo1").split("/");
    expect(parts[0]).toBe("org1");
    expect(parts[1]).toBe("drv1");
  });
});

describe("photoSlotLabel", () => {
  it("labels known slots and degrades gracefully for unknown ones", () => {
    expect(photoSlotLabel("bol")).toBe("Bill of lading");
    expect(photoSlotLabel("custom_slot")).toBe("custom slot");
  });
});

describe("loadSchema (parse, never cast)", () => {
  const base = {
    id: "00000000-0000-4000-8000-00000000000a",
    ref: "LD-1",
    status: "offered",
    equipment: null,
    commodity: null,
    hazmat: false,
    total_miles: "361.5", // PostgREST sends numeric as a string
    accepted_at: null,
    completed_at: null,
    notes: null,
    created_at: "2026-07-27T00:00:00Z",
  };

  it("coerces numeric strings and defaults optional collections", () => {
    const parsed = loadSchema.parse(base);
    expect(parsed.total_miles).toBe(361.5);
    expect(parsed.stops).toEqual([]);
    expect(parsed.vehicle_unit).toBeNull();
  });

  it("rejects an unknown status rather than trusting a drifted server", () => {
    expect(loadSchema.safeParse({ ...base, status: "en_route" }).success).toBe(false);
  });
});
