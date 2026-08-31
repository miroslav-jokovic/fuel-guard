import { describe, expect, it } from "vitest";
import {
  DRIVER_PAGE_SECTIONS,
  DRIVER_SECTIONS,
  RELOCATED_DRIVER_SECTIONS,
  relocatedSectionPath,
  resolveDriverSection,
} from "./driverSections";

/**
 * Where the relocated sections went (R7, D-ROS6).
 *
 * ── WHY THIS IS A SEPARATE FILE FROM `driverSections.test.ts` ───────────────────────────────────
 * R6's done-when says that file must pass UNCHANGED through this work, because it is what guarantees
 * `?section=` — a public surface, in bookmarks and binder references — did not quietly change
 * meaning. Adding assertions to it would make "unchanged" a claim nobody can check with a diff. This
 * file is the new behaviour; that one is the promise that the old behaviour survived it.
 */
describe("relocated driver sections", () => {
  it("still resolves every relocated value, rather than falling back to profile", () => {
    // The failure this prevents: dropping these from the vocabulary so the tab disappears would make
    // `resolveDriverSection` answer `profile`, and a two-year-old link would land silently on the
    // wrong thing instead of being sent onward.
    for (const value of RELOCATED_DRIVER_SECTIONS) {
      expect(resolveDriverSection(value)).toBe(value);
    }
  });

  it("sends the three recruiting sections to the applicant record", () => {
    expect(relocatedSectionPath("application", "dr_1")).toBe("/recruitment/dr_1");
    expect(relocatedSectionPath("employment", "dr_1")).toBe("/recruitment/dr_1");
    expect(relocatedSectionPath("screening", "dr_1")).toBe("/recruitment/dr_1");
  });

  it("leaves the sections that still live on the driver page alone", () => {
    for (const value of ["profile", "qualification", "fuel"] as const) {
      expect(relocatedSectionPath(value, "dr_1")).toBeNull();
    }
  });

  it("renders exactly the sections that did not move, and still knows about the ones that did", () => {
    expect(DRIVER_PAGE_SECTIONS.map((s) => s.value)).toEqual(["profile", "qualification", "fuel"]);
    // The vocabulary keeps all six: the tab list shrank, the public surface did not.
    expect(DRIVER_SECTIONS).toHaveLength(6);
  });

  it("never renders a section it would immediately redirect away from", () => {
    // The two lists are derived from one set, so this cannot drift — but a future hand-edit of either
    // one would make the driver page offer a tab that bounces the reader elsewhere on click.
    for (const s of DRIVER_PAGE_SECTIONS) {
      expect(RELOCATED_DRIVER_SECTIONS.has(s.value)).toBe(false);
    }
  });
});
