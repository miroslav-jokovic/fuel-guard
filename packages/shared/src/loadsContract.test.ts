import { describe, expect, it } from "vitest";
import {
  deliveredWindowQuerySchema,
  loadSchema,
  missingPhotoSlots,
  photoSlotLabel,
  isDocumentSlot,
  PHOTO_SLOTS,
  REQUIRED_PHOTOS_BY_STOP_KIND,
  requiredPhotosFor,
  STOP_KINDS,
  stopPhotoPath,
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
    external_status: null,
    actual_arrival_at: null,
    actual_departure_at: null,
    mcleod_removed_at: null,
    ...over,
  };
}

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

  it("a load from an API without source/acknowledged_at still parses", () => {
    const parsed = loadSchema.parse(base);
    expect(parsed.source).toBe("manual");
    expect(parsed.acknowledged_at).toBeNull();
    expect(parsed.customer_name).toBeNull();
  });

  it("a stop without the McLeod fields still parses", () => {
    const { external_status, actual_arrival_at, actual_departure_at, mcleod_removed_at, ...older } = stop();
    void [external_status, actual_arrival_at, actual_departure_at, mcleod_removed_at];
    const parsed = loadSchema.parse({ ...base, stops: [older] });
    expect(parsed.stops[0]).toMatchObject({ external_status: null, actual_arrival_at: null, actual_departure_at: null, mcleod_removed_at: null });
  });

  it("rejects an unknown status rather than trusting a drifted server", () => {
    expect(loadSchema.safeParse({ ...base, status: "en_route" }).success).toBe(false);
  });
});

describe("deliveredWindowQuerySchema (LOADS-ACTIVITY-PLAN D-LA6)", () => {
  const from = "2026-10-12T05:00:00.000Z";
  const before = "2026-10-19T05:00:00.000Z";
  it("takes both ends or neither", () => {
    expect(deliveredWindowQuerySchema.safeParse({}).success).toBe(true);
    expect(deliveredWindowQuerySchema.safeParse({ delivered_from: from, delivered_before: before }).success).toBe(true);
    expect(deliveredWindowQuerySchema.safeParse({ delivered_from: from }).success).toBe(false);
    expect(deliveredWindowQuerySchema.safeParse({ delivered_before: before }).success).toBe(false);
  });
  it("refuses a window that ends before it starts, and a date with no time", () => {
    expect(deliveredWindowQuerySchema.safeParse({ delivered_from: before, delivered_before: from }).success).toBe(false);
    expect(deliveredWindowQuerySchema.safeParse({ delivered_from: "2026-10-12", delivered_before: before }).success).toBe(false);
  });
});

describe("isDocumentSlot", () => {
  it("scans the bill of lading and photographs everything else", () => {
    expect(isDocumentSlot("bol")).toBe(true);
    for (const slot of ["trailer", "seal", "damage", "load_secured", "other", "custom_slot"]) {
      expect(isDocumentSlot(slot)).toBe(false);
    }
  });
});

describe("the required-photo rule (MCLEOD-API-KIT-PLAN D-MKN5.1)", () => {
  it("every required photo slot is one the driver app can label", () => {
    for (const kind of STOP_KINDS) {
      const slots = REQUIRED_PHOTOS_BY_STOP_KIND[kind];
      expect(slots.length).toBeGreaterThan(0);
      for (const slot of slots) expect(PHOTO_SLOTS as readonly string[]).toContain(slot);
    }
  });

  it("requiredPhotosFor returns a copy, so a writer cannot change the rule", () => {
    const first = requiredPhotosFor("pickup");
    first.push("damage");
    expect(requiredPhotosFor("pickup")).toEqual([...REQUIRED_PHOTOS_BY_STOP_KIND.pickup]);
    expect(requiredPhotosFor("pickup")).not.toBe(requiredPhotosFor("pickup"));
  });
});
