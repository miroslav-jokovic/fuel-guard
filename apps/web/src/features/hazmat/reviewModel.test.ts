import { describe, expect, it } from "vitest";
import type { HazmatLoadRow } from "@silvicom/shared";
import { deriveReviewItems, emptyQueueFilter, filterReviewQueue, hasViolation, labelForFlag } from "./reviewModel";

// The clearing RULES are tested in @silvicom/shared (hazmatReview.test.ts); here we cover the UI-only
// flag → review-item mapping, and re-confirm the re-exported violation classifier is wired through.

describe("reviewModel — flag → review items (UI)", () => {
  it("maps known codes and orders violations first", () => {
    const items = deriveReviewItems(["eligibility_not_checked", "violation:cleaned_tank", "has_preprinted_lines"]);
    expect(items[0]!.tier).toBe("violation");
    expect(items.map((i) => i.code)).toContain("violation:cleaned_tank");
  });
  it("labels prefixed codes readably with the right tier", () => {
    expect(labelForFlag("pass_disagreement:idNumber:line1").tier).toBe("conditional");
    expect(labelForFlag("segregation:incompatible").tier).toBe("violation");
    expect(labelForFlag("line_unresolved:psn_no_match").tier).toBe("violation");
  });
  it("unknown codes fall back to a readable conditional (never hidden)", () => {
    expect(labelForFlag("some_new_flag")).toMatchObject({ tier: "conditional", label: "some new flag" });
  });
  it("re-exports the shared violation classifier", () => {
    expect(hasViolation(["eligibility_blocked"])).toBe(true);
    expect(hasViolation(["dataset_provisional"])).toBe(false);
  });
});

// The queue filter is a pure client helper — the server already returns only `needs_review` loads
// oldest-first; this narrows the visible set by vehicle, driver, and a free-text search.
function load(over: Partial<HazmatLoadRow>): HazmatLoadRow {
  return {
    id: "load-1", org_id: "org-1", vehicle_id: null, trailer_id: null, driver_id: null,
    status: "needs_review", tank_state: "empty", carrier_relationship: "carrier",
    planned_pickup_at: null, declared_lines: [], bol_fields: null, special_permit_numbers: null,
    claimed_no_placards: false, supersedes_load_id: null, version: 1, created_by: null,
    created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z", ...over,
  };
}

describe("reviewModel — queue filter (UI)", () => {
  const rows = [
    load({ id: "aaa", vehicle_id: "v1", driver_id: "d1", declared_lines: [{ hmtRef: "UN1203", psn: "Gasoline" }] }),
    load({ id: "bbb", vehicle_id: "v2", driver_id: "d1", declared_lines: [{ hmtRef: "UN1993", psn: "Diesel" }] }),
    load({ id: "ccc", vehicle_id: "v1", driver_id: "d2", declared_lines: [{ hmtRef: "UN1863", psn: "Jet Fuel" }] }),
  ];

  it("empty filter returns everything", () => {
    expect(filterReviewQueue(rows, emptyQueueFilter())).toHaveLength(3);
  });
  it("filters by vehicle and by driver, combining as AND", () => {
    expect(filterReviewQueue(rows, { ...emptyQueueFilter(), vehicleId: "v1" }).map((l) => l.id)).toEqual(["aaa", "ccc"]);
    expect(filterReviewQueue(rows, { ...emptyQueueFilter(), driverId: "d1" }).map((l) => l.id)).toEqual(["aaa", "bbb"]);
    expect(filterReviewQueue(rows, { ...emptyQueueFilter(), vehicleId: "v1", driverId: "d2" }).map((l) => l.id)).toEqual(["ccc"]);
  });
  it("free-text search matches the load id and declared-line text, case-insensitively", () => {
    expect(filterReviewQueue(rows, { ...emptyQueueFilter(), search: "BBB" }).map((l) => l.id)).toEqual(["bbb"]);
    expect(filterReviewQueue(rows, { ...emptyQueueFilter(), search: "gasoline" }).map((l) => l.id)).toEqual(["aaa"]);
    expect(filterReviewQueue(rows, { ...emptyQueueFilter(), search: "un19" }).map((l) => l.id)).toEqual(["bbb"]);
    expect(filterReviewQueue(rows, { ...emptyQueueFilter(), search: "nomatch" })).toHaveLength(0);
  });
});

describe("the review queue searches by load number (H-U3)", () => {
  const row = (over: Partial<HazmatLoadRow>): HazmatLoadRow =>
    ({ id: "hz-1", declared_lines: [], vehicle_id: null, driver_id: null, ...over }) as HazmatLoadRow;

  it("matches the dispatch load reference, which is how people name a load", () => {
    const rows = [row({ id: "hz-1", load_ref: "41182" }), row({ id: "hz-2", load_ref: "41205" })];
    expect(filterReviewQueue(rows, { ...emptyQueueFilter(), search: "41205" }).map((r) => r.id)).toEqual(["hz-2"]);
  });

  it("still matches a record id, so an existing deep link keeps working", () => {
    const rows = [row({ id: "hz-abc", load_ref: "41182" }), row({ id: "hz-def", load_ref: "41205" })];
    expect(filterReviewQueue(rows, { ...emptyQueueFilter(), search: "hz-def" }).map((r) => r.id)).toEqual(["hz-def"]);
  });

  it("does not crash on a record that was never linked to a load", () => {
    const rows = [row({ id: "hz-1", load_ref: null })];
    expect(filterReviewQueue(rows, { ...emptyQueueFilter(), search: "41182" })).toEqual([]);
    expect(filterReviewQueue(rows, { ...emptyQueueFilter(), search: "" })).toHaveLength(1);
  });
});
