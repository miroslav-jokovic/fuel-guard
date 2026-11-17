import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import NextPmCell from "./NextPmCell.vue";

/**
 * The Vehicles list's "Next PM due" (FleetPal Q11): F11's verdict worded, the due point beside it, and
 * the two "nothing to say" cases kept apart — a schedule nobody can judge is "Can't tell", a truck with
 * no schedule is a dash, and neither is ever "OK".
 */
/** The badge's words and the due point, space-joined — the DOM puts no space between the two pieces. */
const text = (props: Record<string, unknown>) => {
  const el = mount(NextPmCell, { props }).element as HTMLElement;
  const parts = el.children.length ? [...el.children].map((c) => c.textContent ?? "") : [el.textContent ?? ""];
  return parts.map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean).join(" ");
};

describe("NextPmCell", () => {
  it("words each verdict and prints the due point beside it", () => {
    expect(text({ verdict: "overdue", dueAt: "2026-11-01", dueOdometer: null })).toBe("Overdue 11/01/2026");
    expect(text({ verdict: "due", dueAt: "2026-12-01", dueOdometer: "120000" })).toBe("Due soon 12/01/2026 or at 120,000 mi");
    expect(text({ verdict: "ok", dueAt: null, dueOdometer: 150_000 })).toBe("OK at 150,000 mi");
  });

  it("says Can't tell for a schedule it cannot judge, never OK", () => {
    expect(text({ verdict: "unknown", dueAt: "2026-12-01", dueOdometer: null })).toBe("Can't tell 12/01/2026");
  });

  it("shows a dash for a truck with no schedule — no verdict at all", () => {
    expect(text({ verdict: null, dueAt: null, dueOdometer: null })).toBe("—");
    expect(text({})).toBe("—");
  });
});
