import { describe, it, expect } from "vitest";
import {
  APPLICATION_SECTION_KEYS,
  APPLICATION_SECTION_LABELS,
  APPLICATION_SECTION_ORDER,
  isApplicationSection,
  sectionOwning,
  sectionsCoverTheContract,
} from "./applicationSections.js";
import { driverApplicationObject } from "./applicationContract.js";

/**
 * The wizard's promise, as a test (A3).
 *
 * A form split into screens is a promise that every field §391.21(b) requires appears on exactly one
 * of them. Broken, it fails in the worst possible place: the driver fills in everything they were
 * shown, presses send, and the server refuses a document for a field the form never rendered.
 */

describe("every contract field has exactly one screen", () => {
  it("leaves no field homeless and none on two screens", () => {
    const { homeless, duplicated } = sectionsCoverTheContract();
    // Named rather than counted, so the failure says which field and the fix is one step.
    expect(homeless).toEqual([]);
    expect(duplicated).toEqual([]);
  });

  it("claims no field the contract does not have", () => {
    const contractKeys = new Set(Object.keys(driverApplicationObject.shape));
    const claimed = APPLICATION_SECTION_ORDER.flatMap((s) => [...APPLICATION_SECTION_KEYS[s]]);
    expect(claimed.filter((k) => !contractKeys.has(k))).toEqual([]);
  });

  it("finds the screen that owns a field, so an error can send the driver back to it", () => {
    expect(sectionOwning("date_of_birth")).toBe("identity");
    expect(sectionOwning("additional_licences")).toBe("licence");
    expect(sectionOwning("declares_no_accidents")).toBe("safety");
    expect(sectionOwning("signed_name")).toBe("certify");
  });
});

describe("the section vocabulary", () => {
  it("ships with a label for every token", () => {
    for (const section of APPLICATION_SECTION_ORDER) {
      expect(APPLICATION_SECTION_LABELS[section]).toBeTruthy();
    }
  });

  it("ends on the certification, which is the last act of an application", () => {
    expect(APPLICATION_SECTION_ORDER[APPLICATION_SECTION_ORDER.length - 1]).toBe("certify");
    // And review immediately precedes it: nobody certifies what they have not been shown.
    expect(APPLICATION_SECTION_ORDER[APPLICATION_SECTION_ORDER.length - 2]).toBe("review");
  });

  /** `furthest_section` is free text in the database, so a stored value may be anything at all —
   *  including a token from a future version of this form. */
  it("recognises its own tokens and nothing else", () => {
    expect(isApplicationSection("identity")).toBe(true);
    expect(isApplicationSection("documents")).toBe(false);
    expect(isApplicationSection(null)).toBe(false);
    expect(isApplicationSection(7)).toBe(false);
  });
});
