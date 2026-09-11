import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { applicationForReview, approveApplication, editApplication, isReviewError } from "./applicationReview.js";

/**
 * The office's review of an application before the driver certifies it (F4).
 *
 * ⚠ The tests that matter are the WINDOW and the REFUSAL. An office that can change an answer after
 * the driver has been told to sign, or that can put the draft into a state the driver cannot certify,
 * are the two ways this feature turns into a problem rather than a control — and neither looks wrong
 * in a diff.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER_ORG = "99999999-8888-4777-8666-555555555555";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INV = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ACTOR = "cccccccc-dddd-4eee-8fff-000000000000";
const NOW = new Date("2026-09-11T12:00:00Z");

const PAYLOAD = {
  first_name: "Susan",
  last_name: "Godfrey",
  date_of_birth: "1980-04-01",
  email: "s@example.test",
  phone: "555-0111",
  employers: [
    { employer_name: "Old Carrier", city: "Jolliet", started_on: "2023-01-01", ended_on: null, operated_cmv: true, dot_regulated: true },
  ],
  accidents: [],
  declares_no_accidents: true,
};

const invitation = (over: Record<string, unknown> = {}) => ({
  id: INV,
  org_id: ORG,
  driver_id: DRIVER,
  review_requested_at: "2026-09-10T09:00:00Z",
  approved_at: null,
  submitted_at: null,
  ...over,
});

/**
 * ⚠ The invitation is a FUNCTION fixture, not an array, and that is not decoration.
 * `supabaseRecorder` records `.eq()` calls and does not apply them — a flat array answers a query
 * for another carrier's org with this carrier's row. A cross-tenant test written against an array
 * proves nothing about the filter; it proves the fake ignores filters. The function reads the
 * recorded filters and answers the way Postgres would.
 */
const seed = (over: { invitation?: Record<string, unknown> | null; payload?: unknown } = {}) =>
  createSupabaseRecorder({
    tables: {
      application_invitations: (q) => {
        if (over.invitation === null) return [];
        const row = over.invitation ?? invitation();
        const wanted = q.filters().find((f) => f.col === "org_id")?.val;
        return wanted !== undefined && wanted !== row.org_id ? [] : [row];
      },
      application_drafts: over.payload === null ? [] : [{ payload: over.payload ?? PAYLOAD }],
      application_edits: [],
      audit_logs: [],
    },
  });

describe("reading an application for review", () => {
  it("reports where it has got to and whether it may still be changed", async () => {
    const rec = seed();
    const result = await applicationForReview(rec.client, ORG, INV);
    expect(isReviewError(result)).toBe(false);
    if (isReviewError(result)) return;
    expect(result.state).toBe("awaiting_review");
    expect(result.editable).toBe(true);
    expect((result.payload as { first_name?: string })?.first_name).toBe("Susan");
  });

  it("scopes every read to the reader's own org", async () => {
    // The service role bypasses RLS, so the filter is the only thing between two carriers.
    const rec = seed();
    await applicationForReview(rec.client, ORG, INV);
    expectOrgScoped(rec, ORG);
  });

  it("says not found rather than leaking that an invitation exists elsewhere", async () => {
    const rec = seed();
    const result = await applicationForReview(rec.client, OTHER_ORG, INV);
    expect(isReviewError(result) && result.code).toBe("application_not_found");
  });
});

describe("correcting one answer", () => {
  it("writes the corrected draft and records what it was", async () => {
    const rec = seed();
    const result = await editApplication(
      rec.client, ORG, INV,
      { path: ["employers", 0, "city"], value: "Joliet" },
      { actorId: ACTOR },
    );
    expect(isReviewError(result)).toBe(false);

    const saved = rec.writtenRows("application_drafts")[0] as { payload: typeof PAYLOAD };
    expect(saved.payload.employers[0]!.city).toBe("Joliet");

    const edit = rec.writtenRows("application_edits")[0] as Record<string, unknown>;
    expect(edit.path).toEqual(["employers", 0, "city"]);
    // ⚠ The applicant's own answer, kept. Without it the payload alone cannot say what was changed,
    // and the driver cannot be shown the mark D-AX12 requires.
    expect(edit.before).toBe("Jolliet");
    expect(edit.after).toBe("Joliet");
    expect(edit.edited_by).toBe(ACTOR);
  });

  it("leaves the draft untouched when the correction is not a legal answer", async () => {
    // An office typing a word into a number must get a refusal, not a draft the driver then cannot
    // certify — and the refusal must not have written half of itself first.
    const rec = seed();
    const result = await editApplication(
      rec.client, ORG, INV,
      { path: ["accidents"], value: "none I think" },
      { actorId: ACTOR },
    );
    expect(isReviewError(result) && result.code).toBe("invalid_edit");
    expect(rec.writtenRows("application_drafts")).toHaveLength(0);
    expect(rec.writtenRows("application_edits")).toHaveLength(0);
  });

  it("parses the draft as PARTIAL, because a draft is allowed to be unfinished", async () => {
    // Parsing it whole would refuse every correction to an application the driver has not finished,
    // which is most of the ones an office will want to make.
    const rec = seed({ payload: { first_name: "Susan" } });
    const result = await editApplication(
      rec.client, ORG, INV,
      { path: ["last_name"], value: "Godfrey" },
      { actorId: ACTOR },
    );
    expect(isReviewError(result)).toBe(false);
  });

  it("records the change in the audit log as well as the edit table", async () => {
    const rec = seed();
    await editApplication(rec.client, ORG, INV, { path: ["cdl_number"], value: "PA1" }, { actorId: ACTOR });
    const audit = rec.writtenRows("audit_logs")[0] as Record<string, unknown>;
    expect(audit.action).toBe("application_answer_edited");
    expect(audit.entity_id).toBe(INV);
  });
});

/**
 * ⚠ The window. It would be easy to leave editing open until the driver signs — the draft is still a
 * draft. It must not be: approval is what tells the driver *this document, now, please sign it*, and
 * an answer changing underneath them between being asked and signing is the thing this whole flow was
 * built to prevent.
 */
describe("when an answer may be changed, and when it may not", () => {
  it("refuses before the driver has sent it for review", async () => {
    const rec = seed({ invitation: invitation({ review_requested_at: null }) });
    const result = await editApplication(rec.client, ORG, INV, { path: ["cdl_number"], value: "X" }, { actorId: ACTOR });
    expect(isReviewError(result) && result.code).toBe("application_not_editable");
    expect(rec.writtenRows("application_drafts")).toHaveLength(0);
  });

  it("refuses once it has been approved and the driver has been asked to sign", async () => {
    const rec = seed({ invitation: invitation({ approved_at: "2026-09-11T11:00:00Z" }) });
    const result = await editApplication(rec.client, ORG, INV, { path: ["cdl_number"], value: "X" }, { actorId: ACTOR });
    expect(isReviewError(result) && result.code).toBe("application_not_editable");
    expect(rec.writtenRows("application_drafts")).toHaveLength(0);
  });

  it("refuses once it is certified and filed", async () => {
    const rec = seed({
      invitation: invitation({ approved_at: "2026-09-11T11:00:00Z", submitted_at: "2026-09-11T11:30:00Z" }),
    });
    const result = await editApplication(rec.client, ORG, INV, { path: ["cdl_number"], value: "X" }, { actorId: ACTOR });
    expect(isReviewError(result) && result.code).toBe("application_not_editable");
  });
});

describe("approving it", () => {
  it("stamps who approved it and when, and records the act", async () => {
    const rec = seed();
    const result = await approveApplication(rec.client, ORG, INV, { actorId: ACTOR }, NOW);
    expect(isReviewError(result)).toBe(false);

    const row = rec.writtenRows("application_invitations")[0] as Record<string, unknown>;
    expect(row.approved_at).toBe(NOW.toISOString());
    expect(row.approved_by).toBe(ACTOR);
    expect((rec.writtenRows("audit_logs")[0] as Record<string, unknown>).action).toBe("application_approved");
  });

  it("refuses an application the driver has not sent yet", async () => {
    const rec = seed({ invitation: invitation({ review_requested_at: null }) });
    const result = await approveApplication(rec.client, ORG, INV, { actorId: ACTOR }, NOW);
    expect(isReviewError(result) && result.code).toBe("application_not_reviewable");
    expect(rec.writtenRows("application_invitations")).toHaveLength(0);
  });

  it("treats a second approval as the first, because a double-click is not an error", async () => {
    const rec = seed({ invitation: invitation({ approved_at: "2026-09-11T11:00:00Z" }) });
    const result = await approveApplication(rec.client, ORG, INV, { actorId: ACTOR }, NOW);
    expect(isReviewError(result)).toBe(false);
    if (isReviewError(result)) return;
    // The FIRST approval is the one on record; nothing is written again.
    expect(result.approvedAt).toBe("2026-09-11T11:00:00Z");
    expect(rec.writtenRows("application_invitations")).toHaveLength(0);
  });

  it("refuses to re-approve something already signed and filed", async () => {
    const rec = seed({
      invitation: invitation({ approved_at: "2026-09-11T11:00:00Z", submitted_at: "2026-09-11T11:30:00Z" }),
    });
    const result = await approveApplication(rec.client, ORG, INV, { actorId: ACTOR }, NOW);
    expect(isReviewError(result) && result.code).toBe("already_certified");
  });
});
