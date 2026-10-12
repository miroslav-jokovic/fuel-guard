import { describe, it, expect } from "vitest";
import { recordMove } from "./vehicleRecordMoved.js";

// Production, 2026-10-12: record 281474990492891 left 603 for 819; "563 - SOLD" carries 804's VIN.
const row = (id: string, vin: string | null, sid: string | null) => ({ id, vin, samsara_vehicle_id: sid });
const r603 = row("603", "3AKJHHDR6MSMS9682", "SV-819");
const r819 = row("819", "3HSDZAPR8VN167715", null);
const r563 = row("563", "3AKJHHDR8MSMS9649", "SV-563");
const r804 = row("804", "3HSDZAPR8VN844651", "SV-804");
const byVin = new Map([r603, r819, r563, r804].map((r) => [r.vin!, r]));
const live = new Set(["SV-819", "SV-563", "SV-804"]);

describe("recordMove — does the VIN say a linked Samsara record now describes another truck?", () => {
  it("moves a record whose VIN now belongs to a truck with no device — 603 → 819", () => {
    expect(recordMove("SV-819", "3HSDZAPR8VN167715", r603, byVin, live)).toEqual({ kind: "moved", from: r603, to: r819 });
  });

  it("reads Samsara's VIN case- and space-insensitively", () => {
    expect(recordMove("SV-819", " 3hsdzapr8vn167715 ", r603, byVin, live).kind).toBe("moved");
  });

  it("calls it contested when the VIN's truck reports through another live device — 563 vs 804", () => {
    expect(recordMove("SV-563", "3HSDZAPR8VN844651", r563, byVin, live)).toEqual({ kind: "contested", claimedBy: r804 });
  });

  it("moves it when the VIN's truck holds a device Samsara no longer lists", () => {
    const stale = row("804", "3HSDZAPR8VN844651", "SV-GONE");
    const m = new Map([[stale.vin!, stale]]);
    expect(recordMove("SV-563", "3HSDZAPR8VN844651", r563, m, live).kind).toBe("moved");
  });

  it("stays when the VIN agrees, is missing on either side, or names no truck we carry", () => {
    expect(recordMove("SV-819", "3AKJHHDR6MSMS9682", r603, byVin, live).kind).toBe("stay");
    expect(recordMove("SV-819", null, r603, byVin, live).kind).toBe("stay");
    expect(recordMove("SV-819", "3HSDZAPR8VN167715", row("603", null, "SV-819"), byVin, live).kind).toBe("stay");
    expect(recordMove("SV-819", "1XXXXXXXXXXXXXXXX", r603, byVin, live).kind).toBe("stay");
    expect(recordMove("SV-819", "3HSDZAPR8VN167715", undefined, byVin, live).kind).toBe("stay");
  });
});
