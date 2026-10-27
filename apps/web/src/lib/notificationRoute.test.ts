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

  it("a Med-Stop result opens Safety › Drug & Alcohol, which decides what the reader may see", () => {
    expect(notificationRoute("drug_alcohol_result", null, null)).toBe("/drug-alcohol");
    expect(notificationRoute("roadside_feed_stale", null, null)).toBe("/roadside-inspections");
    expect(notificationRoute("medstop_connection", null, null)).toBe("/settings/medstop");
    expect(notificationRoute("roadside_report_needs_review", "roadside_inspection", "i-1")).toBe("/roadside-inspections/i-1");
  });

  it("a roadside repair due opens the Shop's repairs page for maintenance, the inspection for a safety-only reader (Q-IC16)", () => {
    expect(notificationRoute("roadside_repair_due", "roadside_inspection", "i-1")).toBe("/shop/roadside-repairs?inspection=i-1");
    const safetyOnly = (to: string) => !to.startsWith("/shop");
    expect(notificationRoute("roadside_repair_due", "roadside_inspection", "i-1", safetyOnly)).toBe("/roadside-inspections/i-1");
    expect(notificationRoute("roadside_repair_due", "roadside_inspection", "i-1", () => false)).toBeNull();
  });

  it("an applicant ready to screen opens the board on that view; a stalled one opens the board (Q-AW56)", () => {
    expect(notificationRoute("application_ready_to_screen", "driver", "d1")).toBe("/recruitment?waiting=screen");
    expect(notificationRoute("application_stalled", "driver", "d1")).toBe("/recruitment");
  });

  it("a truck or trailer paper opens the unit's File section, by the unit's subject type (UF6)", () => {
    expect(notificationRoute("unit_file_expiring", "tractor", "v1")).toBe("/vehicles/v1?section=file");
    expect(notificationRoute("unit_file_expired", "trailer", "t1")).toBe("/trailers/t1?section=file");
    expect(notificationRoute("unit_file_expired", "driver", "d1")).toBeNull();
  });

  it("messages go to the messages page", () => {
    expect(notificationRoute("message_received", null, null)).toBe("/messages");
  });

  it("a chat mention or reply opens its conversation — a channel at ?ch=, a direct or group line at ?c= (D-CHAT23)", () => {
    const id = "33333333-3333-4333-8333-333333333333";
    expect(notificationRoute("chat_reply", "chat_channel", id)).toBe(`/chat?ch=${id}`);
    expect(notificationRoute("chat_mention", "chat_conversation", id)).toBe(`/chat?c=${id}`);
    expect(notificationRoute("chat_mention", "thread", id)).toBeNull();
    expect(notificationRoute("chat_mention", "chat_channel", null)).toBeNull();
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
