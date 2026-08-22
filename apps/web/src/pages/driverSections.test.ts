import { describe, it, expect } from "vitest";
import { DRIVER_SECTIONS, resolveDriverSection } from "./driverSections";

/**
 * The `?section=` vocabulary (U6, D-UI7).
 *
 * ⚠ This query string is a PUBLIC SURFACE, which is the whole reason U6 was allowed to split the
 * Employment tab at all. `/compliance/:id` redirects into it (D2), the applicant board and the
 * inquiry queue link into it, and it is sitting in bookmarks and binder references. The split added
 * two values and renamed none — these assertions are what make that claim checkable rather than
 * merely stated, and what will fail if a later tidy-up renames `employment` to something prettier.
 */
describe("every historical ?section= value still resolves", () => {
  /** The four that existed before U6. A rename here breaks somebody's bookmark silently. */
  it.each(["profile", "qualification", "employment", "fuel"])("keeps %s", (value) => {
    expect(resolveDriverSection(value)).toBe(value);
  });

  it("adds application and screening without disturbing them", () => {
    expect(resolveDriverSection("application")).toBe("application");
    expect(resolveDriverSection("screening")).toBe("screening");
    expect(DRIVER_SECTIONS.map((s) => s.value)).toEqual([
      "profile",
      "qualification",
      "application",
      "employment",
      "screening",
      "fuel",
    ]);
  });

  /** ⚠ Land somewhere, not nowhere — an unknown section must not render an empty page. */
  it.each([undefined, null, "", "nonsense", "Employment", 42])("falls back to profile for %s", (raw) => {
    expect(resolveDriverSection(raw)).toBe("profile");
  });

  it("gives every section a label, so no tab renders blank", () => {
    for (const s of DRIVER_SECTIONS) expect(s.label.trim()).not.toBe("");
  });
});
