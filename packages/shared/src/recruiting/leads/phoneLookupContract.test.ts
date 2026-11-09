import { describe, expect, it } from "vitest";
import { foldLineType, lookupIsStale, projectTelnyxLookup, PHONE_LOOKUP_STALE_DAYS } from "./phoneLookupContract.js";

describe("phoneLookupContract (LQ8)", () => {
  it("folds Telnyx's words to four: mobile, fixed line → landline, voip; anything else unknown", () => {
    expect(["mobile", "Fixed Line", "fixed line", "voip", "toll free", "pager", "", null, undefined].map(foldLineType))
      .toEqual(["mobile", "landline", "landline", "voip", "unknown", "unknown", "unknown", "unknown", "unknown"]);
  });

  it("projects a good answer: normalized carrier first, else the raw name; valid carried as Telnyx said", () => {
    expect(projectTelnyxLookup({ data: { valid_number: true, carrier: { name: "Telnyx/4", normalized_carrier: "Telnyx", type: "voip", error_code: null } } }))
      .toEqual({ line_type: "voip", carrier: "Telnyx", valid: true });
    expect(projectTelnyxLookup({ data: { valid_number: true, carrier: { name: "T-Mobile USA", normalized_carrier: null, type: "mobile", error_code: null } } }))
      .toEqual({ line_type: "mobile", carrier: "T-Mobile USA", valid: true });
  });

  it("an invalid number or a carrier error is unknown, whatever the type says; a missing carrier block is unknown with valid as given", () => {
    expect(projectTelnyxLookup({ data: { valid_number: false, carrier: { type: "mobile", error_code: null } } })).toEqual({ line_type: "unknown", carrier: null, valid: false });
    expect(projectTelnyxLookup({ data: { valid_number: true, carrier: { type: "mobile", error_code: "10001" } } })).toEqual({ line_type: "unknown", carrier: null, valid: true });
    expect(projectTelnyxLookup({ data: { valid_number: true } })).toEqual({ line_type: "unknown", carrier: null, valid: true });
    expect(projectTelnyxLookup({ data: {} })).toEqual({ line_type: "unknown", carrier: null, valid: null });
  });

  it("a lookup is stale after the window, not before", () => {
    const now = new Date("2026-11-10T00:00:00Z");
    const d = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
    expect([lookupIsStale(d(PHONE_LOOKUP_STALE_DAYS - 1), now), lookupIsStale(d(PHONE_LOOKUP_STALE_DAYS + 1), now)]).toEqual([false, true]);
  });
});
