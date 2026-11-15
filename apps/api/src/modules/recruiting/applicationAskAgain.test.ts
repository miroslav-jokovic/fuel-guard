import { describe, expect, it } from "vitest";
import { ASK_AGAIN_MAX_OPEN, canAskAgain } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { loadEnv } from "../../env.js";
import {
  answerAskAgain, askAgain, isAskAgainError, listAskAgains, openAskAgainCount, openAskAgainsForApplicant, withdrawAskAgain,
} from "./applicationAskAgain.js";
import { hashInvitationToken, isIntakeError } from "./applicationIntake.js";
import { approveApplication, isReviewError } from "./applicationReview.js";

/**
 * The office asks the driver one question again (F5, 0607) — the office's half.
 *
 * What must hold: a question is asked only between the driver's Send and the office's approval; never about
 * an answer the driver can no longer change on their link; asking twice about one answer is one
 * question; five open is the most; a question answered or taken back cannot be taken back; approval
 * waits while one is open; each act is audited without the office's words; every query is org-scoped.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INV = "11111111-2222-4333-8444-555555555555";
const ACTOR = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const NOW = new Date("2026-11-14T15:00:00Z");
const env = loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);

const inv = (over: Record<string, unknown> = {}) => ({
  id: INV, org_id: ORG, driver_id: DRIVER, email: null, application_sent_at: "2026-11-10T00:00:00Z",
  review_requested_at: "2026-11-12T00:00:00Z", approved_at: null, signing_opened_at: null, submitted_at: null, ...over,
});
const q = (over: Record<string, unknown> = {}) => ({
  id: "q-1", path: ["experience"], question: "How many years on a flatbed?", asked_at: "2026-11-13T10:00:00Z",
  answered_at: null, withdrawn_at: null, ...over,
});

const seed = (opts: { inv?: unknown[]; asked?: unknown[]; written?: unknown[] } = {}) =>
  createSupabaseRecorder({
    tables: {
      application_invitations: opts.inv ?? [inv()],
      audit_logs: [],
      application_ask_agains: (r: RecordedQuery) => (r.write ? (opts.written ?? [q({ id: "q-new" })]) : (opts.asked ?? [])),
    },
  });
const writes = (rec: ReturnType<typeof seed>) => rec.writes().filter((w) => w.table === "application_ask_agains");
const audits = (rec: ReturnType<typeof seed>) =>
  rec.writes().filter((w) => w.table === "audit_logs").map((w) => w.write?.payload as Record<string, unknown>);
const BODY = { path: ["experience"] as (string | number)[], question: "How many years on a flatbed?" };

describe("what may be asked", () => {
  it("is any answer the driver can still change — not Part 1's, not the identity", () => {
    for (const key of ["experience", "employers", "accidents", "questionnaire", "addresses", "email"]) expect(canAskAgain([key])).toBe(true);
    for (const key of ["phone", "cdl_number", "cdl_class", "date_of_birth", "additional_licences", "prior_failed_pre_employment_test"]) {
      expect(canAskAgain([key])).toBe(false);
    }
  });
});

describe("asking", () => {
  it("stores the answer's path and the office's words, and audits which answer without the words", async () => {
    const rec = seed();
    const made = await askAgain(rec.client, ORG, INV, BODY, { actorId: ACTOR }, NOW);
    expect(isAskAgainError(made)).toBe(false);
    expect(writes(rec)[0]!.write!.payload).toEqual({
      org_id: ORG, invitation_id: INV, path: ["experience"], question: BODY.question, asked_by: ACTOR, asked_at: NOW.toISOString(),
    });
    const audit = audits(rec).find((a) => a.action === "application_question_asked")!;
    expect(audit.meta).toEqual({ driverId: DRIVER, questionId: "q-new", path: ["experience"] });
    expect(JSON.stringify(audit)).not.toContain("flatbed");
    expectOrgScoped(rec, ORG);
  });

  it("⚠ refuses before the driver has sent the application", async () => {
    const rec = seed({ inv: [inv({ review_requested_at: null })] });
    const r = await askAgain(rec.client, ORG, INV, BODY, { actorId: ACTOR }, NOW);
    expect(isAskAgainError(r) && r.code).toBe("application_not_reviewable");
    expect(writes(rec)).toHaveLength(0);
  });

  it("⚠ refuses once the application is approved, and once it is filed", async () => {
    for (const over of [{ approved_at: "2026-11-13T00:00:00Z" }, { approved_at: "2026-11-13T00:00:00Z", submitted_at: "2026-11-14T00:00:00Z" }]) {
      const rec = seed({ inv: [inv(over)] });
      const r = await askAgain(rec.client, ORG, INV, BODY, { actorId: ACTOR }, NOW);
      expect(isAskAgainError(r) && r.code).toBe("application_not_editable");
      expect(writes(rec)).toHaveLength(0);
    }
  });

  it("⚠ refuses an answer the driver can no longer change on their link", async () => {
    const rec = seed();
    const r = await askAgain(rec.client, ORG, INV, { path: ["cdl_number"], question: "Is this right?" }, { actorId: ACTOR }, NOW);
    expect(isAskAgainError(r) && r.code).toBe("not_askable");
    expect(writes(rec)).toHaveLength(0);
  });

  it("asked twice about one answer is the one question already waiting", async () => {
    const rec = seed({ asked: [q()] });
    const r = await askAgain(rec.client, ORG, INV, BODY, { actorId: ACTOR }, NOW);
    expect(r).toMatchObject({ id: "q-1" });
    expect(writes(rec)).toHaveLength(0);
  });

  it("asks again about an answer whose earlier question is closed", async () => {
    const rec = seed({ asked: [q({ answered_at: "2026-11-13T12:00:00Z" })] });
    expect(await askAgain(rec.client, ORG, INV, BODY, { actorId: ACTOR }, NOW)).toMatchObject({ id: "q-new" });
  });

  it("⚠ stops at the cap of open questions, and does not count closed ones against it", async () => {
    const open = Array.from({ length: ASK_AGAIN_MAX_OPEN }, (_, i) => q({ id: `q-${i}`, path: ["employers", `k${i}`, "ended_on"] }));
    const full = seed({ asked: open });
    const r = await askAgain(full.client, ORG, INV, BODY, { actorId: ACTOR }, NOW);
    expect(isAskAgainError(r) && r.code).toBe("too_many_questions");
    expect(writes(full)).toHaveLength(0);

    const roomy = seed({ asked: open.map((o, i) => (i === 0 ? { ...o, withdrawn_at: "2026-11-13T12:00:00Z" } : o)) });
    expect(isAskAgainError(await askAgain(roomy.client, ORG, INV, BODY, { actorId: ACTOR }, NOW))).toBe(false);
  });

  it("says nothing was sent when the row could not be written, and audits nothing", async () => {
    const rec = seed({ written: [] });
    const r = await askAgain(rec.client, ORG, INV, BODY, { actorId: ACTOR }, NOW);
    expect(isAskAgainError(r) && r.code).toBe("ask_failed");
    expect(audits(rec)).toHaveLength(0);
  });

  it("answers not found for another carrier's application", async () => {
    const r = await askAgain(seed({ inv: [] }).client, ORG, INV, BODY, { actorId: ACTOR }, NOW);
    expect(isAskAgainError(r) && r.code).toBe("application_not_found");
  });
});

describe("taking a question back", () => {
  it("closes an open question, by the filters and not a read before, and audits it", async () => {
    const rec = seed({ written: [q({ withdrawn_at: NOW.toISOString() })] });
    const r = await withdrawAskAgain(rec.client, ORG, INV, "q-1", { actorId: ACTOR }, NOW);
    expect(r).toMatchObject({ id: "q-1", withdrawnAt: NOW.toISOString() });
    const w = writes(rec)[0]!;
    expect(w.write!.payload).toEqual({ withdrawn_at: NOW.toISOString(), withdrawn_by: ACTOR });
    expect(w.ops.filter((o) => o.method === "is").map((o) => String(o.args[0])).sort()).toEqual(["answered_at", "withdrawn_at"]);
    expect(audits(rec).some((a) => a.action === "application_question_withdrawn")).toBe(true);
    expectOrgScoped(rec, ORG);
  });

  it("⚠ refuses one already answered or taken back", async () => {
    const rec = seed({ written: [] });
    const r = await withdrawAskAgain(rec.client, ORG, INV, "q-1", { actorId: ACTOR }, NOW);
    expect(isAskAgainError(r) && r.code).toBe("question_not_open");
    expect(audits(rec)).toHaveLength(0);
  });
});

describe("the list, and what approval reads", () => {
  it("lists every question oldest first and counts only the open ones", async () => {
    const asked = [q(), q({ id: "q-2", answered_at: "2026-11-13T12:00:00Z" }), q({ id: "q-3", withdrawn_at: "2026-11-13T12:00:00Z" })];
    const rec = seed({ asked });
    expect((await listAskAgains(rec.client, ORG, INV)).map((x) => x.id)).toEqual(["q-1", "q-2", "q-3"]);
    expect(await openAskAgainCount(rec.client, ORG, INV)).toBe(1);
  });

  it("⚠ approval waits while a question is open, and says how many", async () => {
    const rec = seed({ asked: [q(), q({ id: "q-2", path: ["employers", "k", "ended_on"] })] });
    const r = await approveApplication(rec.client, env, ORG, INV, { actorId: ACTOR }, NOW);
    expect(isReviewError(r) && r.code).toBe("questions_open");
    expect(isReviewError(r) && r.message).toContain("2 questions are");
    expect(rec.writes().filter((w) => w.table === "application_invitations")).toHaveLength(0);
  });

  it("approval goes through once every question is answered or taken back", async () => {
    const rec = seed({ asked: [q({ answered_at: "2026-11-13T12:00:00Z" }), q({ id: "q-3", withdrawn_at: "2026-11-13T12:00:00Z" })] });
    const r = await approveApplication(rec.client, env, ORG, INV, { actorId: ACTOR }, NOW);
    expect(isReviewError(r)).toBe(false);
  });
});

/** The driver's half: what their page is served, and "Send my answer". */
describe("the driver's side", () => {
  const TOKEN = "i".repeat(43);
  const live = (over: Record<string, unknown> = {}) => inv({
    token_hash: hashInvitationToken(TOKEN), sign_token_hash: null, sms_token_hash: null, expires_at: "2026-12-01T00:00:00Z",
    revoked_at: null, consented_at: "2026-11-01T00:00:00Z", ...over,
  });

  it("is served only the questions still waiting, with the office's words and never who asked", async () => {
    const rec = seed({ asked: [q(), q({ id: "q-2", answered_at: "2026-11-13T12:00:00Z" }), q({ id: "q-3", withdrawn_at: "2026-11-13T12:00:00Z" })] });
    const served = await openAskAgainsForApplicant(rec.client, ORG, INV);
    expect(served.map((x) => x.id)).toEqual(["q-1"]);
    expect(Object.keys(served[0]!).sort()).toEqual(["answeredAt", "askedAt", "id", "path", "question", "withdrawnAt"]);
  });

  it("⚠ stamps the question answered once, by the filters, and audits it with no actor", async () => {
    const rec = seed({ inv: [live()], written: [q({ answered_at: NOW.toISOString() })] });
    const r = await answerAskAgain(rec.client, TOKEN, "q-1", NOW);
    expect(r).toMatchObject({ id: "q-1", answeredAt: NOW.toISOString() });
    const w = writes(rec)[0]!;
    expect(w.write!.payload).toEqual({ answered_at: NOW.toISOString() });
    expect(w.ops.filter((o) => o.method === "is").map((o) => String(o.args[0])).sort()).toEqual(["answered_at", "withdrawn_at"]);
    expect(w.ops.filter((o) => o.method === "eq").map((o) => `${String(o.args[0])}=${String(o.args[1])}`))
      .toEqual(expect.arrayContaining([`org_id=${ORG}`, `invitation_id=${INV}`, "id=q-1"]));
    const audit = audits(rec).find((a) => a.action === "application_question_answered")!;
    expect(audit).toMatchObject({ actor_id: null, meta: { driverId: DRIVER, questionId: "q-1" } });
  });

  it("⚠ says so when the question was taken back or already answered, and audits nothing", async () => {
    const rec = seed({ inv: [live()], written: [] });
    const r = await answerAskAgain(rec.client, TOKEN, "q-1", NOW);
    expect(isIntakeError(r) && r.code).toBe("question_not_open");
    expect(audits(rec)).toHaveLength(0);
  });

  it("answers nothing on a filed application, or on a link that does not resolve", async () => {
    const filed = seed({ inv: [live({ submitted_at: "2026-11-14T00:00:00Z" })] });
    const a = await answerAskAgain(filed.client, TOKEN, "q-1", NOW);
    expect(isIntakeError(a) && a.code).toBe("already_submitted");
    expect(writes(filed)).toHaveLength(0);
    const dead = await answerAskAgain(seed({ inv: [] }).client, TOKEN, "q-1", NOW);
    expect(isIntakeError(dead) && dead.code).toBe("invalid_link");
  });
});

