import { describe, it, expect } from "vitest";
import { notificationRoute } from "./notificationRoute";

/**
 * C6 — the click destination map. Null is a feature: a wrong navigation teaches people not to click
 * any notification, so only certain pairs route.
 */
describe("notificationRoute", () => {
  it("dq_* + driver goes to the qualification file", () => {
    expect(notificationRoute("dq_expired", "driver", "d1")).toBe("/compliance/d1");
    expect(notificationRoute("dq_expiring", "driver", "d1")).toBe("/compliance/d1");
    expect(notificationRoute("dq_mvr_received", "driver", "d1")).toBe("/compliance/d1");
  });

  it("hazmat and dispatch loads route to their detail pages", () => {
    expect(notificationRoute("hazmat_review", "load", "L1")).toBe("/hazmat/loads/L1");
    expect(notificationRoute("load_changed", "load", "L1")).toBe("/dispatch/loads/L1");
  });

  it("a card status change opens the card, and only when it names one", () => {
    expect(notificationRoute("card_status_changed", "efs_card", "c1")).toBe("/fuel-cards/c1");
    expect(notificationRoute("card_status_changed", "efs_card", null)).toBeNull();
    expect(notificationRoute("card_status_changed", "driver", "c1")).toBeNull();
  });

  it("the daily card summary names no card, so it opens the card list (Q-F3, chunk 3b)", () => {
    expect(notificationRoute("card_status_changed", null, null)).toBe("/fuel-cards");
  });

  it("messages go to the messages page", () => {
    expect(notificationRoute("message_received", null, null)).toBe("/messages");
  });

  it("returns null for a destination the reader's guard would refuse (SP5)", () => {
    const opens = (to: string) => !to.startsWith("/hazmat");
    expect(notificationRoute("hazmat_review", "load", "L1", opens)).toBeNull();
    expect(notificationRoute("dq_expired", "driver", "d1", opens)).toBe("/compliance/d1");
  });

  it("anything uncertain returns null — no destination beats a wrong one", () => {
    expect(notificationRoute("dq_expired", "driver", null)).toBeNull();
    expect(notificationRoute("dq_expired", "load", "x")).toBeNull();
    expect(notificationRoute("system", null, null)).toBeNull();
    expect(notificationRoute("fuel_alert", "vehicle", "v1")).toBeNull();
  });
});
