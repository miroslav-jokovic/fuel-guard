import { describe, it, expect } from "vitest";
import { sectionAccess } from "@silvicom/shared";
import {
  SECTION_SAVE_NOTE,
  SURFACE_SAVE_NOTE,
  mergedSectionClaim,
  mergedSurfaceClaim,
  sectionCell,
  sectionReaches,
  surfaceCell,
} from "./layers";

/**
 * The cell logic behind the permissions page (S6, D-SURF6).
 *
 * What is worth pinning here is not "does a spread merge" — it is the two properties that decide
 * whether the page tells an admin the truth:
 *
 *  · **Which layer answered.** A cell reading `View` is useless without it, because "reset" and
 *    "set to view" look identical on such a cell and behave differently afterwards — one keeps
 *    tracking the role, the other does not.
 *  · **Absence is not denial.** Every layer is a sparse delta (D-PERM4/D-SURF6), so a missing entry
 *    must fall through to the layer beneath rather than reading as `none` or as hidden. A page that
 *    got this backwards would show an org a screen full of denials it never wrote.
 */
describe("sectionCell", () => {
  it("falls through to the shipped default when neither layer answered", () => {
    expect(sectionCell("view", undefined, undefined)).toEqual({ access: "view", layer: "default" });
  });

  it("prefers the org's answer for the role over the shipped default", () => {
    expect(sectionCell("view", "manage", undefined)).toEqual({ access: "manage", layer: "role" });
  });

  it("prefers the person's own answer over both", () => {
    expect(sectionCell("view", "manage", "none")).toEqual({ access: "none", layer: "user" });
  });

  /**
   * `none` is a real answer and must not be mistaken for "no answer". This is the shape a
   * falsy-check would get wrong, and it is the answer an org is most likely to write.
   */
  it("treats an explicit `none` as an answer, not as silence", () => {
    expect(sectionCell("manage", "none", undefined)).toEqual({ access: "none", layer: "role" });
    expect(sectionCell("manage", "manage", "none")).toEqual({ access: "none", layer: "user" });
  });
});

describe("surfaceCell", () => {
  /** No row anywhere is the shipped catalogue — a screen is shown unless somebody said otherwise. */
  it("is shown by default", () => {
    expect(surfaceCell(undefined, undefined)).toEqual({ allowed: true, layer: "default" });
  });

  it("reads a role-level denial, and lets the person's own answer overturn it", () => {
    expect(surfaceCell(false, undefined)).toEqual({ allowed: false, layer: "role" });
    // The row 0296's boolean column exists for: one member keeps a screen their whole role lost.
    expect(surfaceCell(false, true)).toEqual({ allowed: true, layer: "user" });
  });

  it("treats an explicit `false` from the person as an answer, not as silence", () => {
    expect(surfaceCell(undefined, false)).toEqual({ allowed: false, layer: "user" });
  });
});

describe("the merged claims the preview is drawn from", () => {
  it("lets the person's answers win, and keeps the role's where they are silent", () => {
    expect(mergedSectionClaim({ fuel: "none", safety: "view" }, { fuel: "manage" })).toEqual({
      fuel: "manage",
      safety: "view",
    });
    expect(mergedSurfaceClaim({ "fuel.ifta": false, "fuel.cards": false }, { "fuel.ifta": true })).toEqual({
      "fuel.ifta": true,
      "fuel.cards": false,
    });
  });
});

describe("sectionReaches", () => {
  /**
   * D-SURF2, asked the way the page asks it. The answers come from the shared matrix rather than
   * being asserted as literals, so a deliberate change to what a dispatcher holds moves this test
   * with it instead of failing it.
   */
  it("asks the same question the sidebar and the router guard ask", () => {
    expect(sectionReaches("dispatcher", "dispatch", "view", null)).toBe(
      sectionAccess("dispatcher", "dispatch") !== "none",
    );
    expect(sectionReaches("dispatcher", "fuel", "manage", null)).toBe(
      sectionAccess("dispatcher", "fuel") === "manage",
    );
  });

  it("reads the org's override rather than the shipped matrix when one exists", () => {
    // A technician holds no fuel access at all; an org that grants it opens the fuel screens.
    expect(sectionReaches("technician", "fuel", "view", null)).toBe(false);
    expect(sectionReaches("technician", "fuel", "view", { fuel: "view" })).toBe(true);
    // …and `view` still does not reach a screen catalogued at `manage`.
    expect(sectionReaches("technician", "fuel", "manage", { fuel: "view" })).toBe(false);
  });
});

/**
 * The two staleness contracts (D-PERM6, D-SURF4). They are asserted as DIFFERENT rather than as
 * exact strings: the plan's requirement is that the page must not average them, and a single shared
 * sentence would be exactly that failure — while the wording itself is copy, and copy is allowed to
 * improve without failing a test.
 */
describe("the save sentences", () => {
  it("says something different about a section change and a screen change", () => {
    expect(SECTION_SAVE_NOTE).not.toBe(SURFACE_SAVE_NOTE);
    expect(SECTION_SAVE_NOTE).toMatch(/hour/i);
    expect(SURFACE_SAVE_NOTE).toMatch(/page/i);
  });
});
