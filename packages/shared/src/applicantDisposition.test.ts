import { describe, expect, it } from "vitest";
import {
  APPLICANT_DISPOSITIONS,
  applicantDispositionCreateSchema,
  currentDisposition,
  isCarrierDecision,
  type ApplicantDispositionRow,
} from "./applicantDisposition.js";

/**
 * The other exit from the applicant pipeline (0238).
 */
const row = (over: Partial<ApplicantDispositionRow>): ApplicantDispositionRow => ({
  id: "11111111-2222-4333-8444-555555555555",
  driver_id: "77777777-8888-4999-8aaa-bbbbbbbbbbbb",
  outcome: "declined",
  decided_on: "2026-08-20",
  reason: null,
  rested_on_consumer_report: false,
  decided_by: null,
  created_at: "2026-08-20T10:00:00Z",
  ...over,
});

describe("the vocabulary", () => {
  /**
   * ⚠ Asserted rather than left to a comment, because the obvious shape is four outcomes and
   * symmetry between the two exits. `drivers.status` plus `hire_date` already record a hire; a second
   * row saying so is one fact in two places, and the two places end up disagreeing.
   */
  it("has no `hired` outcome — a hire is recorded on the driver", () => {
    expect([...APPLICANT_DISPOSITIONS]).toEqual(["declined", "withdrawn", "no_response"]);
  });

  /**
   * The distinction the board renders and the one R10 will need: only a decline is something the
   * carrier DID, and only something the carrier did can owe anybody a notice.
   */
  it("separates what the carrier decided from what happened to it", () => {
    expect(isCarrierDecision("declined")).toBe(true);
    expect(isCarrierDecision("withdrawn")).toBe(false);
    expect(isCarrierDecision("no_response")).toBe(false);
  });
});

describe("the request", () => {
  const body = {
    driver_id: "77777777-8888-4999-8aaa-bbbbbbbbbbbb",
    outcome: "declined" as const,
    decided_on: "2026-08-20",
  };

  it("defaults the consumer-report question to no rather than leaving it unknown", () => {
    const parsed = applicantDispositionCreateSchema.parse(body);
    expect(parsed.rested_on_consumer_report).toBe(false);
  });

  it("refuses a date that is not a date", () => {
    expect(applicantDispositionCreateSchema.safeParse({ ...body, decided_on: "yesterday" }).success)
      .toBe(false);
  });

  /**
   * ⚠ `decided_by` is stamped server-side from the verified JWT. A schema that accepted it would let
   * a client record somebody else as the person who turned an applicant down.
   */
  it("has no field for who decided", () => {
    const parsed = applicantDispositionCreateSchema.parse({ ...body, decided_by: "somebody-else" });
    expect(parsed).not.toHaveProperty("decided_by");
  });
});

describe("which decision stands", () => {
  it("is nothing at all while the application is still open", () => {
    expect(currentDisposition([])).toBeNull();
  });

  /**
   * ⚠ The table is append-only (AD010), so a carrier that changes its mind records a SECOND row.
   * "We said no on the 3rd and yes on the 9th" is a true account of what happened; one mutable row
   * would erase the first half of it.
   */
  it("is the newest, so a change of mind supersedes without erasing", () => {
    const rows = [
      row({ id: "a", outcome: "declined", decided_on: "2026-08-03" }),
      row({ id: "b", outcome: "withdrawn", decided_on: "2026-08-09" }),
    ];
    expect(currentDisposition(rows)?.id).toBe("b");
    // Both survive — the history is the point.
    expect(rows).toHaveLength(2);
  });

  it("breaks a same-day tie on when it was written down", () => {
    expect(currentDisposition([
      row({ id: "a", decided_on: "2026-08-09", created_at: "2026-08-09T09:00:00Z" }),
      row({ id: "b", decided_on: "2026-08-09", created_at: "2026-08-09T17:00:00Z" }),
    ])?.id).toBe("b");
  });

  it("does not reorder the caller's array", () => {
    const rows = [row({ id: "a", decided_on: "2026-08-03" }), row({ id: "b", decided_on: "2026-08-09" })];
    currentDisposition(rows);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });
});
