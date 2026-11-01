import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyCallCorrectionSchema, CALL_CORRECTION_FIELDS, VERIFICATION_QUESTIONS } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../testing/postgrestFixture.js";

/**
 * HW5d: an employer's correction written into the application through the office's one edit door.
 * `editApplication` is stubbed — its window, revision check, parse and log are its own tests'
 * (`applicationReview.test.ts`); what is pinned here is that THIS file aims the edit at the call's
 * employer by key, at the question's own fields, carrying the revision forward, and refuses what
 * there is nothing to apply.
 */
const edits = vi.hoisted(() => ({
  calls: [] as Array<{ invitationId: string; edit: Record<string, unknown> }>,
  refuseAt: null as number | null,
}));
vi.mock("./applicationReview.js", async (orig) => ({
  ...(await orig<typeof import("./applicationReview.js")>()),
  editApplication: vi.fn(async (_admin: unknown, _org: string, invitationId: string, edit: Record<string, unknown>) => {
    edits.calls.push({ invitationId, edit });
    if (edits.refuseAt === edits.calls.length) return { code: "application_not_editable", message: "closed" };
    return { payload: {}, revision: Number(edit.revision) + 1 };
  }),
}));

import { applyCallCorrection } from "./applyCallCorrection.js";

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER = "0f0f0f0f-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INVITE = "10000000-0000-4000-8000-000000000001";
const KEY = "40000000-0000-4000-8000-00000000000a";
const CALL = "50000000-0000-4000-8000-000000000001";
const FOREIGN_CALL = "50000000-0000-4000-8000-000000000002";

const outcomes = (corrected: string[]) =>
  Object.fromEntries(VERIFICATION_QUESTIONS.map((q) => [q, corrected.includes(q) ? "corrected" : "confirmed"]));

const seed = (over: { submitted?: boolean } = {}) =>
  createSupabaseRecorder({
    tables: {
      application_invitations: postgrestFixture([{
        id: INVITE, org_id: ORG, driver_id: DRIVER, created_at: "2026-09-01T00:00:00Z", revoked_at: null,
        submitted_at: over.submitted ? "2026-09-25T00:00:00Z" : null,
      }]),
      employer_verification_calls: postgrestFixture([
        { id: CALL, org_id: ORG, invitation_id: INVITE, employer_key: KEY, employer_name: "ABC Trucking",
          outcomes: outcomes(["dates", "position", "cmv"]), corrections: { dates: "02/2023–11/2024", position: "Driver II", cmv: "No" },
          answered_by: "Pat", called_at: "2026-10-30T15:00:00Z", copied_inquiry_id: null },
        // The same id shape, another carrier's row: never readable from this org.
        { id: FOREIGN_CALL, org_id: OTHER, invitation_id: INVITE, employer_key: KEY, employer_name: "X",
          outcomes: outcomes(["dates"]), corrections: { dates: "x" }, answered_by: "x", called_at: "2026-10-30T15:00:00Z",
          copied_inquiry_id: null },
      ]),
    },
  });

beforeEach(() => {
  edits.calls.length = 0;
  edits.refuseAt = null;
});

describe("applying an employer's correction (HW5d)", () => {
  it("writes both dates to the call's employer by key, the second edit carrying the first's revision", async () => {
    const rec = seed();
    const out = await applyCallCorrection(rec.client, ORG, "u1", DRIVER, CALL,
      { question: "dates", started_on: "2023-02-01", ended_on: "2024-11-30", revision: 7 });
    expect(out).toEqual({ revision: 9, applied: ["started_on", "ended_on"], employerKey: KEY });
    expect(edits.calls.map((c) => c.edit)).toEqual([
      { op: "set", path: ["employers", KEY, "started_on"], value: "2023-02-01", revision: 7 },
      { op: "set", path: ["employers", KEY, "ended_on"], value: "2024-11-30", revision: 8 },
    ]);
    expect(edits.calls.every((c) => c.invitationId === INVITE)).toBe(true);
    expectOrgScoped(rec, ORG);
  });

  it("writes each other question to its own one field", async () => {
    const rec = seed();
    await applyCallCorrection(rec.client, ORG, "u1", DRIVER, CALL, { question: "position", value: "Driver II", revision: 1 });
    await applyCallCorrection(rec.client, ORG, "u1", DRIVER, CALL, { question: "cmv", value: false, revision: 2 });
    expect(edits.calls.map((c) => c.edit.path)).toEqual([
      ["employers", KEY, "position_held"],
      ["employers", KEY, "operated_cmv"],
    ]);
    expect(edits.calls[1]!.edit.value).toBe(false);
  });

  it("refuses an answer the employer confirmed — there is nothing to apply", async () => {
    const out = await applyCallCorrection(seed().client, ORG, "u1", DRIVER, CALL, { question: "reason", value: "Moved", revision: 1 });
    expect(out).toMatchObject({ code: "nothing_to_apply" });
    expect(edits.calls).toHaveLength(0);
  });

  it("never reads another carrier's call", async () => {
    const out = await applyCallCorrection(seed().client, ORG, "u1", DRIVER, FOREIGN_CALL,
      { question: "dates", started_on: "2023-01-01", ended_on: null, revision: 1 });
    expect(out).toMatchObject({ code: "call_not_found" });
    expect(edits.calls).toHaveLength(0);
  });

  it("sends a filed application's correction to the employment list instead", async () => {
    const out = await applyCallCorrection(seed({ submitted: true }).client, ORG, "u1", DRIVER, CALL,
      { question: "position", value: "Driver II", revision: 1 });
    expect(out).toMatchObject({ code: "already_filed" });
    expect(edits.calls).toHaveLength(0);
  });

  it("passes the edit door's refusal through, and says which half was written when the second is refused", async () => {
    edits.refuseAt = 1;
    expect(await applyCallCorrection(seed().client, ORG, "u1", DRIVER, CALL, { question: "position", value: "Driver II", revision: 1 }))
      .toEqual({ code: "application_not_editable", message: "closed" });
    edits.calls.length = 0;
    edits.refuseAt = 2;
    const half = await applyCallCorrection(seed().client, ORG, "u1", DRIVER, CALL,
      { question: "dates", started_on: "2023-02-01", ended_on: "2024-11-30", revision: 1 });
    expect(half).toMatchObject({ code: "application_not_editable" });
    expect((half as { message: string }).message).toContain("started_on");
  });
});

describe("the apply contract", () => {
  it("refuses dates that end before they start, and a blank position", () => {
    expect(applyCallCorrectionSchema.safeParse({ question: "dates", started_on: "2024-05-01", ended_on: "2024-04-01", revision: 0 }).success).toBe(false);
    expect(applyCallCorrectionSchema.safeParse({ question: "position", value: "  ", revision: 0 }).success).toBe(false);
    expect(applyCallCorrectionSchema.safeParse({ question: "dates", started_on: "2024-05-01", ended_on: null, revision: 0 }).success).toBe(true);
  });

  it("maps each question to the application's own field — dot_tested is §391.21(b)(10)(iv)(B), safety_sensitive", () => {
    // Literal on purpose: a mapping compared with itself certifies nothing.
    expect(CALL_CORRECTION_FIELDS).toEqual({
      dates: ["started_on", "ended_on"],
      position: ["position_held"],
      reason: ["reason_for_leaving"],
      cmv: ["operated_cmv"],
      dot_tested: ["safety_sensitive"],
    });
    expect(Object.keys(CALL_CORRECTION_FIELDS).sort()).toEqual([...VERIFICATION_QUESTIONS].sort());
  });
});
