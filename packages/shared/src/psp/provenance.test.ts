import { describe, it, expect } from "vitest";
import {
  PSP_SOURCE_API,
  PSP_SOURCE_IMPORT,
  hasStructuredPspData,
  isImportedPspRecord,
  pspRecordSource,
} from "./provenance.js";

/**
 * P9's "from data, never inferred" rule, pinned.
 *
 * The failure this prevents: an ORDERED record for a driver with no inspections carries no counts,
 * looks exactly like an unread import, and would be labelled one by any heuristic based on absence.
 * A clean record and an unexamined one are indistinguishable from the outside (D-PSP5) — which is
 * the whole reason the writer states the source.
 */
describe("where a PSP record came from", () => {
  it("reads the stated source", () => {
    expect(pspRecordSource({ source: PSP_SOURCE_API })).toBe("psp_api");
    expect(pspRecordSource({ source: PSP_SOURCE_IMPORT })).toBe("portal_import");
  });

  it("calls a record with no stated source unknown, not imported", () => {
    for (const detail of [null, undefined, {}, { summary: "x" }]) {
      expect(pspRecordSource(detail)).toBe("unknown");
      expect(isImportedPspRecord(detail)).toBe(false);
    }
  });

  it("does not mistake an ordered record with no findings for an import", () => {
    const cleanOrder = { source: PSP_SOURCE_API, inspections: 0, crashes: 0 };
    expect(isImportedPspRecord(cleanOrder)).toBe(false);
    expect(hasStructuredPspData(cleanOrder)).toBe(true);
  });

  it("treats an unread PDF as carrying no structured data", () => {
    expect(hasStructuredPspData({ source: PSP_SOURCE_IMPORT, structured: false })).toBe(false);
    // An unrecorded source answers false too: rendering counts nothing produced is the worse error.
    expect(hasStructuredPspData({})).toBe(false);
  });
});
