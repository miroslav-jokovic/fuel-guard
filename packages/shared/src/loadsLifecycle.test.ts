import { describe, expect, it } from "vitest";
import {
  acceptanceCopy,
  canTransition,
  DRIVER_VISIBLE_STATUSES,
  declineLoadRequestSchema,
  isDriverVisible,
  isTerminal,
  LOAD_STATUSES,
  LOAD_TRANSITIONS,
  loadBucket,
  resolveDriverType,
  type LoadStatus,
} from "./index.js";

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
