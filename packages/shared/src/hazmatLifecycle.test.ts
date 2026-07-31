import { describe, expect, it } from "vitest";
import {
  hazmatTransition, legalEvents, canEditLoad, isHazmatLoadTerminal, isClearingEvent,
  HAZMAT_LOAD_STATUSES, HAZMAT_LOAD_EVENTS, type HazmatLoadStatus,
} from "./hazmatLifecycle.js";

describe("hazmatLifecycle — locked load state machine (plan H4)", () => {
  it("allows exactly the plan's forward transitions", () => {
    const legal: Array<[HazmatLoadStatus, string, string]> = [
      ["draft", "submit", "submitted"],
      ["submitted", "start_extraction", "extracting"],
      ["submitted", "analysis_green", "cleared"],
      ["extracting", "analysis_green", "cleared"],
      ["submitted", "analysis_flagged", "needs_review"],
      ["extracting", "analysis_flagged", "needs_review"],
      ["needs_review", "review_cleared", "cleared"],
      ["needs_review", "review_rejected", "rejected"],
      ["draft", "cancel", "cancelled"],
      ["submitted", "cancel", "cancelled"],
      ["needs_review", "cancel", "cancelled"],
      ["cleared", "supersede", "superseded"],
      ["rejected", "resubmit", "submitted"],
      ["cleared", "rerun", "needs_review"],
    ];
    for (const [from, event, to] of legal) {
      const r = hazmatTransition(from, event as never);
      expect(r.ok, `${from} --${event}--> ${to}`).toBe(true);
      expect(r.to).toBe(to);
    }
  });

  it("rejects illegal transitions with a safe message", () => {
    expect(hazmatTransition("cleared", "submit").ok).toBe(false);          // cleared is immutable-forward
    expect(hazmatTransition("cancelled", "submit").ok).toBe(false);        // terminal
    expect(hazmatTransition("draft", "review_cleared").ok).toBe(false);    // can't clear a draft
    expect(hazmatTransition("cleared", "cancel").ok).toBe(false);          // cleared can't be cancelled
    expect(hazmatTransition("draft", "analysis_green").ok).toBe(false);    // must be submitted/extracting
    const r = hazmatTransition("cleared", "submit");
    expect(r.error).toMatch(/illegal transition/i);
  });

  it("only a draft is editable (cleared loads are immutable)", () => {
    expect(canEditLoad("draft")).toBe(true);
    for (const s of HAZMAT_LOAD_STATUSES.filter((x) => x !== "draft")) expect(canEditLoad(s)).toBe(false);
  });

  it("marks superseded + cancelled as terminal, and clearing events for the provisional guard", () => {
    expect(isHazmatLoadTerminal("superseded")).toBe(true);
    expect(isHazmatLoadTerminal("cancelled")).toBe(true);
    expect(isHazmatLoadTerminal("cleared")).toBe(false); // cleared can supersede/rerun
    expect(isClearingEvent("analysis_green")).toBe(true);
    expect(isClearingEvent("review_cleared")).toBe(true);
    expect(isClearingEvent("submit")).toBe(false);
  });

  it("legalEvents matches the transition table for each status", () => {
    expect(legalEvents("draft").sort()).toEqual(["cancel", "submit"]);
    expect(legalEvents("submitted").sort()).toEqual(["analysis_flagged", "analysis_green", "cancel", "start_extraction"]);
    expect(legalEvents("needs_review").sort()).toEqual(["cancel", "review_cleared", "review_rejected"]);
    expect(legalEvents("cleared").sort()).toEqual(["rerun", "supersede"]);
    expect(legalEvents("superseded")).toEqual([]); // terminal — no events
    expect(legalEvents("cancelled")).toEqual([]);
  });

  it("every event has a valid target status (table integrity)", () => {
    for (const e of HAZMAT_LOAD_EVENTS) {
      const froms = HAZMAT_LOAD_STATUSES.filter((s) => hazmatTransition(s, e).ok);
      expect(froms.length, `event ${e} must be legal from ≥1 status`).toBeGreaterThan(0);
      for (const f of froms) expect(HAZMAT_LOAD_STATUSES).toContain(hazmatTransition(f, e).to!);
    }
  });
});
