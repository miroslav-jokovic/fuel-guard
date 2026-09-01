import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import InspectionExpiryCell from "@/features/maintenance/InspectionExpiryCell.vue";

/**
 * The roster's annual-inspection column (D-AVI16).
 *
 * One component on two pages, so "expiring" cannot come to mean two things on two screens. What is
 * pinned here is the WORDS, because a badge that says the right colour and the wrong sentence is
 * still wrong to somebody walking the yard.
 */
const cell = (expiresOn: string | null, today = "2026-06-16") =>
  mount(InspectionExpiryCell, { props: { expiresOn, today } });

describe("what the yard reads", () => {
  it("shows the date plainly when it is far off", () => {
    expect(cell("2027-06-16").text()).toContain("2027-06-16");
  });

  it("counts down inside the warning window", () => {
    expect(cell("2026-06-28").text()).toContain("Due in 12 days");
    expect(cell("2026-06-17").text()).toContain("Due in 1 day");
  });

  it("says DUE TODAY rather than 'in 0 days'", () => {
    expect(cell("2026-06-16").text()).toContain("Due today");
  });

  it("counts up once overdue, and says overdue", () => {
    expect(cell("2026-06-15").text()).toContain("Overdue by 1 day");
    expect(cell("2026-05-16").text()).toContain("Overdue by 31 days");
  });

  it("says NOT RECORDED with no date, never overdue", () => {
    // A truck that arrived last week has no inspection on file; calling that overdue reports a
    // compliance failure nobody has established.
    const text = cell(null).text();
    expect(text).toContain("Not recorded");
    expect(text).not.toContain("Overdue");
  });

  it("still shows the date beside the warning, so the reader can plan", () => {
    expect(cell("2026-06-28").text()).toContain("2026-06-28");
  });
});
