import { beforeEach, describe, it, expect, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { loadEnv } from "../../env.js";
import { applicationForReview, approveApplication, editApplication, isReviewError } from "./applicationReview.js";

/**
 * ⚠ Approval now SENDS (Q-AX4), so the mailer is stubbed here the way the nudge sweep stubs it. The
 * property these tests exist for is the ORDER and the INDEPENDENCE: the stamp and the audit row are
 * written before anything is sent, and a refused send never becomes a failed approval — an applicant
 * who is allowed to sign must never be left behind a state that says they are not.
 */
const sent = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../../lib/mailer.js", () => ({ sendEmail: sent.fn }));

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

/** A live mail provider, so the send is attempted rather than skipped as `mail_disabled`. */
const env = () =>
  loadEnv({
    NODE_ENV: "test",
    WEB_APP_URL: "https://app.test",
    MAIL_PROVIDER: "resend",
    RESEND_API_KEY: "re_test",
  } as NodeJS.ProcessEnv);

/**
 * A payload in the shape `toDraftPayload` actually writes — NOT a hand-made contract-shaped object.
 *
 * ⚠ That distinction is the whole of the 2026-09-11 defect. The autosaved draft carries
 * `questionnaire` (the carrier's own answers, as the form holds them), empty strings where the
 * driver has answered nothing, and no `certified`/`signed_name`. The edit path parsed it with the
 * CERTIFIED contract, which is `.strict()`, so every real correction was refused on an unrecognised
 * key — and the fixture here was contract-shaped, so nothing failed.
 */
const PAYLOAD = {
  first_name: "Susan",
  middle_name: "",
  last_name: "Godfrey",
  other_names: [],
  date_of_birth: "1980-04-01",
  email: "s@example.test",
  phone: "555-0111",
  addresses: [
    { line1: "1 Elm St", line2: "", city: "Joliet", state: "IL", postal_code: "60431", from: "2019-04", to: "" },
  ],
  cdl_number: "D1234",
  cdl_state: "IL",
  cdl_class: "A",
  cdl_expires_at: "2028-04-01",
  experience: "Twelve years, mostly dry van.",
  equipment_experience: [
    { equipment_class: "tractor_semi_trailer", equipment_type: "Van", from: "2019-04", to: "", approx_miles: "" },
  ],
  employers: [
    {
      employer_name: "Old Carrier", usdot_number: "", address_line1: "", city: "Jolliet", state: "IL",
      phone: "", email: "", position_held: "Driver", started_on: "2023-01-01", ended_on: "2026-01-01",
      operated_cmv: true, dot_regulated: true, reason_for_leaving: "", subject_to_fmcsr: true, safety_sensitive: true,
    },
  ],
  declares_no_employment: false,
  accidents: [],
  declares_no_accidents: true,
  violations: [],
  declares_no_violations: true,
  licence_ever_denied: false,
  licence_denial_detail: "",
  prior_failed_pre_employment_test: false,
  additional_licences: [],
  questionnaire: { proof_of_age: true },
};

const invitation = (over: Record<string, unknown> = {}) => ({
  id: INV,
  org_id: ORG,
  driver_id: DRIVER,
  email: "susan@example.test",
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
/** A v2 invitation's Part 1 (C3c2c2): its row, one licence, and the class Part 1 wrote to `drivers`. */
const PART_ONE = {
  application_intakes: [{
    phone: "+13125550142", address_line1: "1 Main St", address_line2: null, city: "Joliet", state: "IL",
    postal_code: "60431", prior_positive_2y: true,
  }],
  application_intake_licences: [{ position: 0, state_code: "IL", agency: null, licence_number: "IL123", expires_on: "2029-03-01" }],
  drivers: [{ cdl_class: "A" }],
};

const seed = (over: {
  invitation?: Record<string, unknown> | null;
  payload?: unknown;
  v2?: boolean;
  /** The stored draft revision (0376). */
  revision?: number;
  /** What `save_application_draft` answers — DA041 when the phone saved first. */
  save?: unknown;
  /** Marks the driver has already made on the packet. */
  marks?: number;
} = {}) =>
  createSupabaseRecorder({
    rpc: { save_application_draft: over.save ?? { draft_id: "d-1", updated_at: "2026-09-11T12:00:00Z", revision: (over.revision ?? 3) + 1 } },
    tables: {
      application_packet_marks: { data: [], count: over.marks ?? 0 },
      ...(over.v2 ? PART_ONE : { application_intakes: [] }),
      application_invitations: (q) => {
        if (over.invitation === null) return [];
        const row = over.invitation ?? invitation();
        const wanted = q.filters().find((f) => f.col === "org_id")?.val;
        return wanted !== undefined && wanted !== row.org_id ? [] : [row];
      },
      application_drafts: over.payload === null ? [] : [{ payload: over.payload ?? PAYLOAD, revision: over.revision ?? 3 }],
      application_edits: [],
      audit_logs: [],
      // Read by the approval notice (Q-AX4): the carrier's own name, and the applicant's SMS consent.
      organizations: [{ name: "Silvicom Inc" }],
      sms_consents: [],
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

  /**
   * C3c2c2 (Q-AW34): the office reads a v2 application as filing will compose it, so it is handed Part
   * 1's facts and the carrier's day beside the draft — and a legacy application none.
   */
  it("hands the office a v2 application's Part 1 facts, and a legacy one none", async () => {
    const v2 = await applicationForReview(seed({ v2: true }).client, ORG, INV);
    if (isReviewError(v2)) throw new Error(v2.message);
    expect(v2.partOne?.intake).toMatchObject({ phone: "+13125550142", prior_positive_2y: true, cdl_class: "A" });
    expect(v2.partOne?.licences).toHaveLength(1);
    expect(v2.partOne?.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const legacy = await applicationForReview(seed().client, ORG, INV);
    if (isReviewError(legacy)) throw new Error(legacy.message);
    expect(legacy.partOne).toBeNull();
  });

  it("scopes a v2 application's Part 1 reads to the reader's own org", async () => {
    const rec = seed({ v2: true });
    await applicationForReview(rec.client, ORG, INV);
    expectOrgScoped(rec, ORG);
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

const REV = 3;
const KEY = "11111111-2222-4333-8444-555555555555";
const KEYED = { ...PAYLOAD, employers: PAYLOAD.employers.map((e) => ({ ...e, key: KEY })) };
const savedPayload = (rec: ReturnType<typeof seed>) =>
  (rec.rpcs().find((r) => r.fn === "save_application_draft")!.args as { p_payload: typeof PAYLOAD & { employment_gaps?: unknown[] } }).p_payload;

describe("correcting one answer", () => {
  it("writes the corrected draft through the revision check and records what it was", async () => {
    const rec = seed({ payload: KEYED });
    const result = await editApplication(
      rec.client, ORG, INV,
      { path: ["employers", KEY, "city"], value: "Joliet", revision: REV },
      { actorId: ACTOR },
    );
    expect(isReviewError(result)).toBe(false);
    if (isReviewError(result)) return;
    expect(result.revision).toBe(REV + 1);

    // §8.1: the RPC with the revision the office read — never a bare update of the draft.
    const call = rec.rpcs().find((r) => r.fn === "save_application_draft")!.args as Record<string, unknown>;
    expect(call).toMatchObject({ p_org: ORG, p_invitation: INV, p_driver: DRIVER, p_expected_revision: REV, p_section: null });
    expect(rec.writtenRows("application_drafts")).toHaveLength(0);
    expect(savedPayload(rec).employers[0]!.city).toBe("Joliet");

    const edit = rec.writtenRows("application_edits")[0] as Record<string, unknown>;
    // Q-AX7: the row by its key, so a later removal re-points nothing.
    expect(edit.path).toEqual(["employers", KEY, "city"]);
    // ⚠ The applicant's own answer, kept. Without it the payload alone cannot say what was changed,
    // and the driver cannot be shown the mark D-AX12 requires.
    expect(edit.before).toBe("Jolliet");
    expect(edit.after).toBe("Joliet");
    expect(edit.edited_by).toBe(ACTOR);
  });

  it("§9 P5: refuses a stale revision — the applicant changed it since the office read it — writing nothing", async () => {
    const rec = seed({ payload: KEYED });
    const result = await editApplication(
      rec.client, ORG, INV, { path: ["cdl_number"], value: "PA1", revision: REV - 1 }, { actorId: ACTOR },
    );
    expect(isReviewError(result) && result.code).toBe("draft_revision_conflict");
    expect(rec.rpcs()).toEqual([]);
    expect(rec.writtenRows("application_edits")).toHaveLength(0);
  });

  it("§9 P5: maps the database's own refusal (DA041) — the phone saved between the read and the write", async () => {
    const rec = seed({ payload: KEYED, save: { error: { code: "DA041", message: "draft_revision_conflict" } } });
    const result = await editApplication(
      rec.client, ORG, INV, { path: ["cdl_number"], value: "PA1", revision: REV }, { actorId: ACTOR },
    );
    expect(isReviewError(result) && result.code).toBe("draft_revision_conflict");
    expect(isReviewError(result) && result.message).toContain("reload");
    expect(rec.writtenRows("application_edits")).toHaveLength(0);
  });

  it("EM-2: fills a field the applicant left blank (a null cell)", async () => {
    const rec = seed({ payload: { ...KEYED, employers: [{ ...KEYED.employers[0]!, subject_to_fmcsr: null }] } });
    const result = await editApplication(
      rec.client, ORG, INV, { path: ["employers", KEY, "subject_to_fmcsr"], value: false, revision: REV }, { actorId: ACTOR },
    );
    expect(isReviewError(result)).toBe(false);
    expect(savedPayload(rec).employers[0]!.subject_to_fmcsr).toBe(false);
    expect((rec.writtenRows("application_edits")[0] as Record<string, unknown>).before).toBeNull();
  });

  it("Q-AX7: a row that had no key is given one, and the edit is logged under it", async () => {
    const rec = seed();
    const result = await editApplication(
      rec.client, ORG, INV, { path: ["employers", 0, "city"], value: "Joliet", revision: REV }, { actorId: ACTOR },
    );
    expect(isReviewError(result)).toBe(false);
    const minted = savedPayload(rec).employers[0] as { key?: string };
    expect(minted.key).toMatch(/^[0-9a-f-]{36}$/);
    expect((rec.writtenRows("application_edits")[0] as Record<string, unknown>).path).toEqual(["employers", minted.key, "city"]);
  });

  it("Q-AX7: refuses a position for a row that already has a key — rows are named by key", async () => {
    const rec = seed({ payload: KEYED });
    const result = await editApplication(
      rec.client, ORG, INV, { path: ["employers", 0, "city"], value: "Joliet", revision: REV }, { actorId: ACTOR },
    );
    expect(isReviewError(result) && result.code).toBe("invalid_edit");
    expect(rec.rpcs()).toEqual([]);
  });

  it("leaves the draft untouched when the correction is not a legal answer", async () => {
    // An office typing a word into a number must get a refusal, not a draft the driver then cannot
    // certify — and the refusal must not have written half of itself first.
    const rec = seed();
    const result = await editApplication(
      rec.client, ORG, INV, { path: ["accidents"], value: "none I think", revision: REV }, { actorId: ACTOR },
    );
    expect(isReviewError(result) && result.code).toBe("invalid_edit");
    expect(rec.rpcs()).toEqual([]);
    expect(rec.writtenRows("application_edits")).toHaveLength(0);
  });

  it("⚠ does not refuse a real autosaved draft for carrying the carrier's own questions", async () => {
    // The regression that made this whole feature inert: `questionnaire` is a draft key and not a
    // key of the certified document, the certified contract is `.strict()`, and every correction to
    // every real application came back "That is not a valid answer for this field".
    const rec = seed({ payload: KEYED });
    const result = await editApplication(
      rec.client, ORG, INV, { path: ["employers", KEY, "position_held"], value: "Line-haul driver", revision: REV }, { actorId: ACTOR },
    );
    expect(isReviewError(result)).toBe(false);
    // The answers it does not understand are kept exactly as they were — the draft written is the
    // edited COPY, never the schema's output.
    expect(savedPayload(rec).questionnaire).toEqual({ proof_of_age: true });
  });

  it("parses the draft as PARTIAL, because a draft is allowed to be unfinished", async () => {
    const rec = seed({ payload: { first_name: "Susan" } });
    const result = await editApplication(
      rec.client, ORG, INV, { path: ["last_name"], value: "Godfrey", revision: REV }, { actorId: ACTOR },
    );
    expect(isReviewError(result)).toBe(false);
  });

  it("records the change in the audit log as well as the edit table", async () => {
    const rec = seed();
    await editApplication(rec.client, ORG, INV, { path: ["cdl_number"], value: "PA1", revision: REV }, { actorId: ACTOR });
    const audit = rec.writtenRows("audit_logs")[0] as Record<string, unknown>;
    expect(audit.action).toBe("application_answer_edited");
    expect(audit.entity_id).toBe(INV);
  });

  it("scopes every read and write to the office's own org", async () => {
    const rec = seed({ payload: KEYED });
    await editApplication(rec.client, ORG, INV, { path: ["cdl_number"], value: "PA1", revision: REV }, { actorId: ACTOR });
    expectOrgScoped(rec, ORG);
  });
});

/**
 * The office visit's real correction (2026-09-14, §9 P5): the jobs the driver cannot remember. Added
 * with a street (EM-3), removed with a reason (Q-AX7, by key), and the gaps between them explained.
 */
describe("the jobs: add, remove, explain a gap", () => {
  const WERNER = {
    key: "22222222-3333-4444-8555-666666666666",
    employer_name: "Werner", usdot_number: "", address_line1: "14507 Frontier Rd", city: "Omaha", state: "NE",
    phone: "", email: "", position_held: "Driver", started_on: "2019-03-01", ended_on: "2021-06-01",
    operated_cmv: true, dot_regulated: true, reason_for_leaving: "Moved", subject_to_fmcsr: true,
    safety_sensitive: true,
  };

  it("adds a job with its street at the end of the list, logged by its key", async () => {
    const rec = seed({ payload: KEYED });
    const result = await editApplication(rec.client, ORG, INV, { op: "add_employer", employer: WERNER, revision: REV }, { actorId: ACTOR });
    expect(isReviewError(result)).toBe(false);
    const employers = savedPayload(rec).employers as unknown as Array<{ employer_name: string; address_line1: string }>;
    expect(employers.map((e) => e.employer_name)).toEqual(["Old Carrier", "Werner"]);
    expect(employers[1]!.address_line1).toBe("14507 Frontier Rd");
    const edit = rec.writtenRows("application_edits")[0] as Record<string, unknown>;
    expect(edit.path).toEqual(["employers", WERNER.key]);
    expect(edit.before).toBeNull();
  });

  it("refuses a job missing the fields the regulation needs, writing nothing", async () => {
    const rec = seed({ payload: KEYED });
    const result = await editApplication(
      rec.client, ORG, INV, { op: "add_employer", employer: { key: WERNER.key, employer_name: "Werner" }, revision: REV }, { actorId: ACTOR },
    );
    expect(isReviewError(result)).toBe(true);
    expect(rec.rpcs()).toEqual([]);
  });

  it("removes a job by its key, and logs the whole row it removed", async () => {
    const rec = seed({ payload: { ...KEYED, employers: [...KEYED.employers, WERNER] } });
    const result = await editApplication(rec.client, ORG, INV, { op: "remove_employer", key: KEY, revision: REV }, { actorId: ACTOR });
    expect(isReviewError(result)).toBe(false);
    expect((savedPayload(rec).employers as unknown as Array<{ key: string }>).map((e) => e.key)).toEqual([WERNER.key]);
    const edit = rec.writtenRows("application_edits")[0] as Record<string, unknown>;
    expect(edit.path).toEqual(["employers", KEY]);
    expect((edit.before as { employer_name: string }).employer_name).toBe("Old Carrier");
    expect(edit.after).toBeNull();
  });

  it("refuses to remove a job that is no longer there", async () => {
    const rec = seed({ payload: KEYED });
    const result = await editApplication(
      rec.client, ORG, INV, { op: "remove_employer", key: WERNER.key, revision: REV }, { actorId: ACTOR },
    );
    expect(isReviewError(result) && result.code).toBe("invalid_edit");
  });

  it("explains a gap, and replaces the explanation for the same gap rather than adding a second", async () => {
    const gap = { from: "2021-06-01", to: "2023-01-01", explanation: "Caring for a parent" };
    const rec = seed({ payload: { ...KEYED, employment_gaps: [{ ...gap, explanation: "Off" }] } });
    const result = await editApplication(rec.client, ORG, INV, { op: "explain_gap", gap, revision: REV }, { actorId: ACTOR });
    expect(isReviewError(result)).toBe(false);
    expect(savedPayload(rec).employment_gaps).toEqual([gap]);
    const edit = rec.writtenRows("application_edits")[0] as Record<string, unknown>;
    expect(edit.path).toEqual(["employment_gaps", "2021-06-01"]);
    expect(edit.before).toBe("Off");
    expect(edit.after).toBe("Caring for a parent");
  });
});

/**
 * ⚠ The window (§9 P5, Q-WF5): from the office's SEND until the driver's first mark on the packet.
 * It used to close at approval; the protection that mattered is kept where it is real — once the
 * driver is signing, the document does not move underneath them.
 */
describe("when an answer may be changed, and when it may not", () => {
  it("EM-1: lets the office type while the applicant is still filling it in — before they send", async () => {
    const rec = seed({ invitation: invitation({ review_requested_at: null, application_sent_at: "2026-09-09T09:00:00Z" }) });
    const result = await editApplication(rec.client, ORG, INV, { path: ["cdl_number"], value: "X1", revision: REV }, { actorId: ACTOR });
    expect(isReviewError(result)).toBe(false);
  });

  it("EM-1: makes the first draft when the applicant has typed nothing yet (revision 0)", async () => {
    const rec = seed({ payload: null, invitation: invitation({ review_requested_at: null, application_sent_at: "2026-09-09T09:00:00Z" }) });
    const result = await editApplication(rec.client, ORG, INV, { path: ["cdl_number"], value: "X1", revision: 0 }, { actorId: ACTOR });
    expect(isReviewError(result)).toBe(false);
    expect((rec.rpcs()[0]!.args as Record<string, unknown>).p_expected_revision).toBe(0);
  });

  it("refuses before the office has sent the form at all", async () => {
    const rec = seed({ invitation: invitation({ review_requested_at: null }) });
    const result = await editApplication(rec.client, ORG, INV, { path: ["cdl_number"], value: "X", revision: REV }, { actorId: ACTOR });
    expect(isReviewError(result) && result.code).toBe("application_not_editable");
    expect(rec.rpcs()).toEqual([]);
  });

  it("EM-4: lets the office correct after approval, while the driver has not signed anything", async () => {
    const rec = seed({ invitation: invitation({ approved_at: "2026-09-11T11:00:00Z" }) });
    const result = await editApplication(rec.client, ORG, INV, { path: ["cdl_number"], value: "X", revision: REV }, { actorId: ACTOR });
    expect(isReviewError(result)).toBe(false);
  });

  it("refuses once the driver has made a mark on the packet", async () => {
    const rec = seed({ invitation: invitation({ approved_at: "2026-09-11T11:00:00Z", signing_opened_at: "2026-09-11T11:10:00Z" }), marks: 1 });
    const result = await editApplication(rec.client, ORG, INV, { path: ["cdl_number"], value: "X", revision: REV }, { actorId: ACTOR });
    expect(isReviewError(result) && result.code).toBe("application_not_editable");
    expect(rec.rpcs()).toEqual([]);
  });

  it("refuses once it is certified and filed", async () => {
    const rec = seed({
      invitation: invitation({ approved_at: "2026-09-11T11:00:00Z", submitted_at: "2026-09-11T11:30:00Z" }),
    });
    const result = await editApplication(rec.client, ORG, INV, { path: ["cdl_number"], value: "X", revision: REV }, { actorId: ACTOR });
    expect(isReviewError(result) && result.code).toBe("application_not_editable");
  });
});

describe("approving it", () => {
  beforeEach(() => {
    sent.fn.mockReset();
    sent.fn.mockResolvedValue({ ok: true, provider: "resend", status: 200 });
  });

  it("stamps who approved it and when, and records the act", async () => {
    const rec = seed();
    const result = await approveApplication(rec.client, env(), ORG, INV, { actorId: ACTOR }, NOW);
    expect(isReviewError(result)).toBe(false);

    const row = rec.writtenRows("application_invitations")[0] as Record<string, unknown>;
    expect(row.approved_at).toBe(NOW.toISOString());
    expect(row.approved_by).toBe(ACTOR);
    expect((rec.writtenRows("audit_logs")[0] as Record<string, unknown>).action).toBe("application_approved");
  });

  it("refuses an application the driver has not sent yet", async () => {
    const rec = seed({ invitation: invitation({ review_requested_at: null }) });
    const result = await approveApplication(rec.client, env(), ORG, INV, { actorId: ACTOR }, NOW);
    expect(isReviewError(result) && result.code).toBe("application_not_reviewable");
    expect(rec.writtenRows("application_invitations")).toHaveLength(0);
  });

  it("treats a second approval as the first, because a double-click is not an error", async () => {
    const rec = seed({ invitation: invitation({ approved_at: "2026-09-11T11:00:00Z" }) });
    const result = await approveApplication(rec.client, env(), ORG, INV, { actorId: ACTOR }, NOW);
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
    const result = await approveApplication(rec.client, env(), ORG, INV, { actorId: ACTOR }, NOW);
    expect(isReviewError(result) && result.code).toBe("already_certified");
    expect(sent.fn).not.toHaveBeenCalled();
  });

  /**
   * Q-AX4. Until this shipped, the ONLY thing that told an applicant their application had been
   * approved was them reopening their own link on the off-chance — while the recruiter's drawer said
   * "the applicant has been asked to sign it".
   */
  it("tells the applicant they are approved and will sign in the office", async () => {
    const rec = seed();
    const result = await approveApplication(rec.client, env(), ORG, INV, { actorId: ACTOR }, NOW);
    expect(isReviewError(result)).toBe(false);
    if (isReviewError(result)) return;

    expect(result.notice).toMatchObject({ sent: true, email: "susan@example.test", reason: null });
    const mail = sent.fn.mock.calls[0]![1] as { to: string[]; subject: string; text: string; html: string };
    expect(mail.to).toEqual(["susan@example.test"]);
    expect(mail.subject).toBe("Silvicom Inc has approved your application");
    expect(mail.text).toContain("You sign it in their office");
    /**
     * ⚠ AF5 (D-AF3). This assertion has now been reversed twice. Until 2026-09-18 the email carried
     * no link because there was none to send; A5b (D-AX15) minted one; AF5 moved signing into the
     * office, where 0369 refuses every mark until the office opens it — so a link here would open a
     * packet that refuses every place on it.
     */
    expect(`${mail.text}${mail.html}`).not.toMatch(/\/apply\//);
  });

  /**
   * ⚠ And approval MINTS nothing any more. The sign link belongs to the office's Send for signing
   * (`open_packet_signing`, 0369); a token minted here and never sent would be a live credential on
   * the row with no copy anywhere — and one minted AND sent would be the remote signing D-AF3 removed.
   */
  it("writes no token of either kind, only the approval", async () => {
    const rec = seed();
    await approveApplication(rec.client, env(), ORG, INV, { actorId: ACTOR }, NOW);
    const writes = rec.writtenRows("application_invitations") as Record<string, unknown>[];
    expect(writes).toHaveLength(1);
    expect(writes.some((w) => "sign_token_hash" in w || "token_hash" in w)).toBe(false);
  });

  it("approves anyway when the message cannot be sent, and says so", async () => {
    sent.fn.mockResolvedValue({ ok: false, provider: "resend", status: 422, detail: "bad address" });
    const rec = seed();
    const result = await approveApplication(rec.client, env(), ORG, INV, { actorId: ACTOR }, NOW);
    expect(isReviewError(result)).toBe(false);
    if (isReviewError(result)) return;

    // ⚠ The approval is what the certification route reads. A mail provider refusing an address must
    // never leave a driver who is ALLOWED to sign sitting behind a state that says they are not.
    expect(result.notice).toMatchObject({ sent: false, reason: "send_failed" });
    expect((rec.writtenRows("application_invitations")[0] as Record<string, unknown>).approved_at)
      .toBe(NOW.toISOString());
    expect((rec.writtenRows("audit_logs")[0] as Record<string, unknown>).action).toBe("application_approved");
  });

  it("does not tell the applicant twice when the recruiter double-clicks", async () => {
    const rec = seed({ invitation: invitation({ approved_at: "2026-09-11T11:00:00Z" }) });
    const result = await approveApplication(rec.client, env(), ORG, INV, { actorId: ACTOR }, NOW);
    expect(isReviewError(result)).toBe(false);
    if (isReviewError(result)) return;
    expect(result.notice.reason).toBe("already_notified");
    expect(sent.fn).not.toHaveBeenCalled();
  });

  it("says no_address rather than failing when the recruiter invited with a link alone", async () => {
    const rec = seed({ invitation: invitation({ email: null }) });
    const result = await approveApplication(rec.client, env(), ORG, INV, { actorId: ACTOR }, NOW);
    expect(isReviewError(result)).toBe(false);
    if (isReviewError(result)) return;
    expect(result.notice).toMatchObject({ sent: false, reason: "no_address" });
    expect(sent.fn).not.toHaveBeenCalled();
  });
});
