import { describe, expect, it } from "vitest";
import {
  acceptanceCopy,
  approvalChecklist,
  canTransition,
  DRIVER_VISIBLE_STATUSES,
  declineLoadRequestSchema,
  isDriverVisible,
  isTerminal,
  LOAD_STATUSES,
  LOAD_TRANSITIONS,
  loadBucket,
  resolveDriverType,
  type ApprovableLoad,
  type LoadStatus,
} from "./index.js";

function stop(over: Partial<ApprovableLoad["stops"][number]> = {}) {
  return {
    kind: "pickup" as const,
    seq: 1,
    name: "Shipper",
    appointment_start: "2026-07-28T08:00:00.000Z",
    appointment_end: "2026-07-28T10:00:00.000Z",
    required_photos: ["trailer", "bol"],
    ...over,
  };
}

function load(over: Partial<ApprovableLoad> = {}): ApprovableLoad {
  return {
    driver_id: "00000000-0000-4000-8000-0000000000d1",
    vehicle_id: "00000000-0000-4000-8000-000000000001",
    trailer_id: "00000000-0000-4000-8000-000000000011",
    equipment: "Dry van",
    commodity: "General freight",
    hazmat: false,
    stops: [stop(), stop({ kind: "dropoff", seq: 2, name: "Consignee", required_photos: ["bol"] })],
    ...over,
  };
}

describe("driver visibility — the approval gate's client half", () => {
  it("exposes exactly the five statuses the RLS predicate allows", () => {
    expect([...DRIVER_VISIBLE_STATUSES]).toEqual([
      "offered",
      "accepted",
      "in_transit",
      "delivered",
      "canceled",
    ]);
  });

  it("hides everything before release", () => {
    expect(isDriverVisible("draft")).toBe(false);
    expect(isDriverVisible("pending_approval")).toBe(false);
    expect(isDriverVisible("approved")).toBe(false);
    expect(isDriverVisible("offered")).toBe(true);
  });

  it("buckets only driver-visible statuses into the app's three tabs", () => {
    // Regression guard for F1: `accepted` must NOT read as Current, and `in_transit` must.
    expect(loadBucket("offered")).toBe("upcoming");
    expect(loadBucket("accepted")).toBe("upcoming");
    expect(loadBucket("in_transit")).toBe("current");
    expect(loadBucket("delivered")).toBe("previous");
  });
});

describe("LOAD_TRANSITIONS", () => {
  it("covers every status with no gaps", () => {
    for (const s of LOAD_STATUSES) expect(LOAD_TRANSITIONS[s]).toBeDefined();
  });

  it("never lets a load skip the approval gate", () => {
    expect(canTransition("draft", "offered")).toBe(false);
    expect(canTransition("draft", "approved")).toBe(false);
    expect(canTransition("pending_approval", "offered")).toBe(false);
    expect(canTransition("approved", "offered")).toBe(true);
  });

  it("walks the happy path", () => {
    const path: LoadStatus[] = [
      "draft",
      "pending_approval",
      "approved",
      "offered",
      "accepted",
      "in_transit",
      "delivered",
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it("lets a decline fall back to the dispatch queue", () => {
    expect(canTransition("offered", "approved")).toBe(true);
    expect(canTransition("accepted", "approved")).toBe(true);
  });

  it("treats delivered and canceled as terminal", () => {
    expect(isTerminal("delivered")).toBe(true);
    expect(isTerminal("canceled")).toBe(true);
    expect(canTransition("delivered", "in_transit")).toBe(false);
    expect(isTerminal("offered")).toBe(false);
  });

  it("allows cancellation from every live state", () => {
    for (const s of LOAD_STATUSES) {
      if (s === "delivered" || s === "canceled") continue;
      expect(canTransition(s, "canceled")).toBe(true);
    }
  });
});

describe("approvalChecklist — what makes approval a control, not a rubber stamp", () => {
  it("passes a complete load", () => {
    const r = approvalChecklist(load());
    expect(r.canApprove).toBe(true);
    expect(r.blockers).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  it("blocks and NAMES a missing driver", () => {
    const r = approvalChecklist(load({ driver_id: null }));
    expect(r.canApprove).toBe(false);
    expect(r.blockers.map((b) => b.id)).toContain("driver_assigned");
    expect(r.blockers.find((b) => b.id === "driver_assigned")?.detail).toBeTruthy();
  });

  it("blocks a missing truck", () => {
    expect(approvalChecklist(load({ vehicle_id: null })).canApprove).toBe(false);
  });

  it("blocks a load with no dropoff", () => {
    const r = approvalChecklist(load({ stops: [stop()] }));
    expect(r.blockers.map((b) => b.id)).toContain("has_dropoff");
  });

  it("blocks a load with no stops at all and says so", () => {
    const r = approvalChecklist(load({ stops: [] }));
    expect(r.canApprove).toBe(false);
    expect(r.blockers.find((b) => b.id === "appointments_set")?.detail).toContain("no stops");
  });

  it("names which stops are missing an appointment window", () => {
    const r = approvalChecklist(
      load({ stops: [stop({ name: "Acme Foods", appointment_end: null }), stop({ kind: "dropoff", seq: 2 })] }),
    );
    expect(r.canApprove).toBe(false);
    expect(r.blockers.find((b) => b.id === "appointments_set")?.detail).toContain("Acme Foods");
  });

  it("catches a hazardous commodity with the hazmat flag off", () => {
    const r = approvalChecklist(load({ commodity: "Propane cylinders", hazmat: false }));
    expect(r.canApprove).toBe(false);
    expect(r.blockers.map((b) => b.id)).toContain("hazmat_consistent");
  });

  it("is satisfied once hazmat is flagged", () => {
    expect(approvalChecklist(load({ commodity: "Propane cylinders", hazmat: true })).canApprove).toBe(true);
  });

  it("warns about a missing trailer without blocking — the driver confirms it at the shipper", () => {
    const r = approvalChecklist(load({ trailer_id: null }));
    expect(r.canApprove).toBe(true);
    expect(r.warnings.map((w) => w.id)).toContain("trailer_assigned");
  });

  it("does not even warn when the equipment implies no trailer", () => {
    const r = approvalChecklist(load({ trailer_id: null, equipment: "Bobtail" }));
    expect(r.warnings.map((w) => w.id)).not.toContain("trailer_assigned");
  });

  it("warns when a stop asks for no photos — the driver would capture nothing there", () => {
    const r = approvalChecklist(
      load({ stops: [stop({ required_photos: [] }), stop({ kind: "dropoff", seq: 2 })] }),
    );
    expect(r.canApprove).toBe(true);
    expect(r.warnings.map((w) => w.id)).toContain("photo_slots_set");
  });

  it("reports every blocker at once rather than one at a time", () => {
    const r = approvalChecklist({ driver_id: null, vehicle_id: null, stops: [] });
    expect(r.blockers.length).toBeGreaterThanOrEqual(4);
  });
});

describe("acceptance semantics (D46) — one mechanism, two labels", () => {
  it("resolves the driver override over the org default", () => {
    expect(resolveDriverType("owner_operator", "company")).toBe("owner_operator");
    expect(resolveDriverType(null, "owner_operator")).toBe("owner_operator");
    expect(resolveDriverType(null, null)).toBe("company");
    expect(resolveDriverType("nonsense", null)).toBe("company");
  });

  it("gives a company driver acknowledgement copy and no auto-unassign", () => {
    const c = acceptanceCopy("company");
    expect(c.primary).toBe("I'm ready");
    expect(c.unassignsOnDecline).toBe(false);
    expect(c.reasons).not.toContain("rate_distance");
  });

  it("gives an owner-operator a real accept/decline that returns the load", () => {
    const c = acceptanceCopy("owner_operator");
    expect(c.primary).toBe("Accept");
    expect(c.unassignsOnDecline).toBe(true);
    expect(c.reasons).toContain("rate_distance");
  });
});

describe("decline request", () => {
  it("requires a reason from the fixed set", () => {
    expect(declineLoadRequestSchema.safeParse({ reason: "hours_of_service" }).success).toBe(true);
    expect(declineLoadRequestSchema.safeParse({}).success).toBe(false);
    expect(declineLoadRequestSchema.safeParse({ reason: "because" }).success).toBe(false);
  });

  it("caps the free-text note", () => {
    expect(
      declineLoadRequestSchema.safeParse({ reason: "other", note: "x".repeat(501) }).success,
    ).toBe(false);
  });
});
