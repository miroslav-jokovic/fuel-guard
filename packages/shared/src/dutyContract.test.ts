import { describe, expect, it } from "vitest";
import {
  changeEquipmentRequestSchema,
  currentSegment,
  dutyEquipmentLabel,
  dutyGate,
  dutySessionSchema,
  equipmentMismatch,
  equipmentRequiresTrailer,
  isOnDuty,
  isStaleSession,
  meEquipmentResponseSchema,
  segmentAt,
  sessionHours,
  startShiftRequestSchema,
  type DutySegment,
  type DutySession,
} from "./index.js";

const VEH_A = "00000000-0000-4000-8000-000000000001";
const VEH_B = "00000000-0000-4000-8000-000000000002";
const TRL_A = "00000000-0000-4000-8000-000000000011";
const TRL_B = "00000000-0000-4000-8000-000000000012";

function segment(over: Partial<DutySegment> = {}): DutySegment {
  return {
    id: "00000000-0000-4000-8000-0000000000a1",
    vehicle_id: VEH_A,
    vehicle_unit: "214",
    trailer_id: TRL_A,
    trailer_unit: "5521",
    seat: "driver",
    from_at: "2026-07-27T06:00:00.000Z",
    to_at: null,
    confirmed_by: "driver",
    note: null,
    ...over,
  };
}

function session(over: Partial<DutySession> = {}): DutySession {
  return {
    id: "00000000-0000-4000-8000-0000000000f1",
    driver_id: "00000000-0000-4000-8000-0000000000d1",
    started_at: "2026-07-27T06:00:00.000Z",
    ended_at: null,
    ended_reason: null,
    start_odometer: 412_003,
    end_odometer: null,
    source: "driver_app",
    segments: [segment()],
    ...over,
  };
}

/** A shift that swapped trailers at 10:00 — the shape every attribution question hangs off. */
function swappedSession(): DutySession {
  return session({
    segments: [
      segment({
        id: "00000000-0000-4000-8000-0000000000a1",
        trailer_id: TRL_A,
        trailer_unit: "5521",
        from_at: "2026-07-27T06:00:00.000Z",
        to_at: "2026-07-27T10:00:00.000Z",
      }),
      segment({
        id: "00000000-0000-4000-8000-0000000000a2",
        trailer_id: TRL_B,
        trailer_unit: "7788",
        from_at: "2026-07-27T10:00:00.000Z",
        to_at: null,
      }),
    ],
  });
}

describe("currentSegment / isOnDuty", () => {
  it("returns the open segment while the shift is running", () => {
    expect(currentSegment(swappedSession())?.trailer_unit).toBe("7788");
    expect(isOnDuty(session())).toBe(true);
  });

  it("returns null once the shift has ended", () => {
    const ended = session({
      ended_at: "2026-07-27T18:00:00.000Z",
      ended_reason: "driver",
      segments: [segment({ to_at: "2026-07-27T18:00:00.000Z" })],
    });
    expect(currentSegment(ended)).toBeNull();
    expect(isOnDuty(ended)).toBe(false);
  });

  it("treats a missing session as off duty", () => {
    expect(isOnDuty(null)).toBe(false);
    expect(currentSegment(undefined)).toBeNull();
  });
});

describe("segmentAt — the attribution primitive", () => {
  const s = swappedSession();

  it("attributes a fuel purchase to the trailer hooked at that moment", () => {
    expect(segmentAt(s, "2026-07-27T08:30:00.000Z")?.trailer_unit).toBe("5521");
    expect(segmentAt(s, "2026-07-27T14:10:00.000Z")?.trailer_unit).toBe("7788");
  });

  it("is half-open, so the changeover instant belongs to exactly one segment", () => {
    expect(segmentAt(s, "2026-07-27T10:00:00.000Z")?.trailer_unit).toBe("7788");
  });

  it("returns null before the shift started and for an unparseable instant", () => {
    expect(segmentAt(s, "2026-07-27T05:59:59.000Z")).toBeNull();
    expect(segmentAt(s, "not-a-date")).toBeNull();
  });
});

describe("equipmentRequiresTrailer", () => {
  it("requires a trailer for the usual equipment types", () => {
    expect(equipmentRequiresTrailer("Dry van")).toBe(true);
    expect(equipmentRequiresTrailer("Reefer")).toBe(true);
    expect(equipmentRequiresTrailer("Flatbed")).toBe(true);
  });

  it("does not require one when the load explicitly says bobtail", () => {
    expect(equipmentRequiresTrailer("Bobtail")).toBe(false);
    expect(equipmentRequiresTrailer(" none ")).toBe(false);
  });

  it("does not block on an unknown or missing value — the gate is a prompt, not a wall", () => {
    expect(equipmentRequiresTrailer(null)).toBe(false);
    expect(equipmentRequiresTrailer("")).toBe(false);
  });
});

describe("dutyGate — the staged soft gate (D44)", () => {
  it("asks for a check-in when there is no shift", () => {
    expect(dutyGate(null)).toBe("no_shift");
    expect(dutyGate(null, { requiresTrailer: true })).toBe("no_shift");
  });

  it("passes a bobtail driver until the work actually needs a trailer", () => {
    const bobtail = session({ segments: [segment({ trailer_id: null, trailer_unit: null })] });
    expect(dutyGate(bobtail)).toBe("ok");
    expect(dutyGate(bobtail, { requiresTrailer: true })).toBe("no_trailer");
  });

  it("passes once truck and trailer are both confirmed", () => {
    expect(dutyGate(session(), { requiresTrailer: true })).toBe("ok");
  });
});

describe("session duration & the auto-close mirror", () => {
  const now = Date.parse("2026-07-27T21:00:00.000Z"); // 15h after a 06:00 start

  it("measures an open shift against now", () => {
    expect(sessionHours(session(), now)).toBeCloseTo(15, 5);
  });

  it("measures a closed shift against its end", () => {
    const ended = session({ ended_at: "2026-07-27T14:00:00.000Z", ended_reason: "driver" });
    expect(sessionHours(ended, now)).toBeCloseTo(8, 5);
  });

  it("flags a shift the sweeper would close, and never an already-closed one", () => {
    expect(isStaleSession(session(), 16, now)).toBe(false);
    expect(isStaleSession(session(), 15, now)).toBe(true);
    const ended = session({ ended_at: "2026-07-26T14:00:00.000Z", ended_reason: "auto_timeout" });
    expect(isStaleSession(ended, 1, now)).toBe(false);
  });
});

describe("dutyEquipmentLabel", () => {
  it("names the truck and trailer", () => {
    expect(dutyEquipmentLabel(session())).toBe("Unit 214 · Trailer 5521");
  });

  it("says bobtail rather than leaving a blank", () => {
    expect(dutyEquipmentLabel(session({ segments: [segment({ trailer_id: null })] }))).toBe(
      "Unit 214 · Bobtail",
    );
  });

  it("is null when off duty", () => {
    expect(dutyEquipmentLabel(null)).toBeNull();
  });
});

describe("equipmentMismatch (D47)", () => {
  it("is null when the driver is in what dispatch planned", () => {
    expect(equipmentMismatch(session(), { vehicle_id: VEH_A, trailer_id: TRL_A })).toBeNull();
  });

  it("reports which side differs", () => {
    expect(equipmentMismatch(session(), { vehicle_id: VEH_B, trailer_id: TRL_A })).toEqual({
      vehicle: true,
      trailer: false,
    });
    expect(equipmentMismatch(session(), { vehicle_id: VEH_A, trailer_id: TRL_B })).toEqual({
      vehicle: false,
      trailer: true,
    });
  });

  it("ignores an unplanned side rather than inventing a mismatch", () => {
    expect(equipmentMismatch(session(), { vehicle_id: null, trailer_id: null })).toBeNull();
  });

  it("is null with no session — nothing to compare against", () => {
    expect(equipmentMismatch(null, { vehicle_id: VEH_B })).toBeNull();
  });
});

describe("request schemas", () => {
  const base = {
    session_id: "00000000-0000-4000-8000-0000000000f1",
    segment_id: "00000000-0000-4000-8000-0000000000a1",
    vehicle_id: VEH_B,
  };

  it("accepts a minimal check-in and defaults take_over to false", () => {
    const parsed = startShiftRequestSchema.parse(base);
    expect(parsed.take_over).toBe(false);
    expect(parsed.trailer_id ?? null).toBeNull();
  });

  it("rejects a check-in with no vehicle — a shift always has a truck", () => {
    expect(startShiftRequestSchema.safeParse({ ...base, vehicle_id: undefined }).success).toBe(false);
  });

  it("rejects a negative start odometer", () => {
    expect(startShiftRequestSchema.safeParse({ ...base, start_odometer: -1 }).success).toBe(false);
  });

  it("rejects an equipment change that changes nothing", () => {
    const res = changeEquipmentRequestSchema.safeParse({ segment_id: base.segment_id });
    expect(res.success).toBe(false);
  });

  it("rejects clear_trailer together with a trailer_id", () => {
    const res = changeEquipmentRequestSchema.safeParse({
      segment_id: base.segment_id,
      trailer_id: TRL_B,
      clear_trailer: true,
    });
    expect(res.success).toBe(false);
  });

  it("accepts a drop to bobtail", () => {
    const res = changeEquipmentRequestSchema.safeParse({
      segment_id: base.segment_id,
      clear_trailer: true,
    });
    expect(res.success).toBe(true);
  });
});

describe("response schemas parse rather than cast (D24)", () => {
  it("coerces PostgREST's stringified numerics", () => {
    const parsed = dutySessionSchema.parse({
      ...session(),
      start_odometer: "412003.0",
      end_odometer: null,
    });
    expect(parsed.start_odometer).toBe(412003);
  });

  it("fails loudly on an unknown end reason instead of caching garbage", () => {
    const res = dutySessionSchema.safeParse({ ...session(), ended_at: "x", ended_reason: "vanished" });
    expect(res.success).toBe(false);
  });

  it("defaults the pick list's optional display fields", () => {
    const parsed = meEquipmentResponseSchema.parse({
      vehicles: [{ id: VEH_A, unit_number: "214" }],
      trailers: [],
    });
    expect(parsed.vehicles[0]).toMatchObject({ make: null, in_use_by: null, is_default: false });
  });
});
