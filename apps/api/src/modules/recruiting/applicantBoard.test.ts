import { describe, it, expect } from "vitest";
import { driverPlacementIds, hiringChecklist, hiringStep, APPLICATION_RELEASE_ORDER } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../testing/postgrestFixture.js";
import { boardChecklists, type BoardApplicantInput } from "./applicantBoard.js";

/**
 * Every applicant's checklist, folded in one pass (B4).
 *
 * Three properties carry this file, and the third is the one B3's tests could not reach:
 *
 *   · **the projection is the fold's answer**, never a second reading of the evidence. Asserted by
 *     building the same state twice — as rows and as fold inputs — and demanding the board's
 *     `next`, `phase` and `waiting_on` agree with what `hiringChecklist` said about the second.
 *   · **the tenant scope is explicit**, because the service role bypasses RLS.
 *   · ⚠ **the reads do not multiply with the board.** A loop over B3 would be seven queries per
 *     applicant; the measured failure that shape causes is `LIVE-MAP-CONCURRENCY-PLAN.md` §7, and
 *     one applicant's worth of test fixtures cannot tell the two implementations apart. So one test
 *     below folds SIX applicants and counts the queries.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER_ORG = "99999999-8888-4777-8666-555555555555";
const NOW = new Date("2026-09-18T12:00:00Z");

const driverId = (n: number) => `d0000000-0000-4000-8000-00000000000${n}`;
const inviteId = (n: number) => `10000000-0000-4000-8000-00000000000${n}`;

const own = (row: Record<string, unknown>) => ({ org_id: ORG, ...row });

const authRows = (driver: string) =>
  APPLICATION_RELEASE_ORDER.map((purpose, i) => ({
    id: `auth-${driver}-${i}`,
    purpose,
    accepted_at: "2026-09-01T00:00:00Z",
    revokes: null,
  }));

/**
 * One applicant's INPUT half — what the pipeline route already read and hands over.
 *
 * ⚠ The invitation is chosen by the caller, so the fixture supplies it here rather than in a table.
 * That is the shape the service was built to, and the reason is in its header: two independent reads
 * of `application_invitations` could pick different rows and then disagree in adjacent columns.
 */
const applicant = (n: number, over: Partial<BoardApplicantInput> = {}): BoardApplicantInput => ({
  driverId: driverId(n),
  hiredAt: null,
  invitation: {
    id: inviteId(n),
    created_at: "2026-09-01T00:00:00Z",
    application_sent_at: "2026-09-01T12:00:00Z",
    review_requested_at: "2026-09-02T00:00:00Z",
    approved_at: "2026-09-03T00:00:00Z",
    signing_opened_at: "2026-09-08T00:00:00Z",
    submitted_at: null,
  },
  hasDraft: true,
  applyingAs: null,
  authorizations: authRows(driverId(n)),
  decided: false,
  ...over,
});

const seed = (over: Record<string, Array<Record<string, unknown>>> = {}) => {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    qualification_records: [
      { driver_id: driverId(1), kind: "mvr", created_at: "2026-09-04T00:00:00Z" },
      { driver_id: driverId(1), kind: "psp_report", created_at: "2026-09-05T00:00:00Z" },
    ],
    psp_requests: [{ id: "psp-1", driver_id: driverId(1) }],
    application_packet_marks: [],
    // ⚠ Q-HM9, and seeded for driver 1 ONLY on purpose. The six-applicant test folds these same
    // rows, so a service that forgot to group by driver — or that handed every applicant the whole
    // org's employment history — gives drivers 2–6 an investigation they do not owe. A fixture that
    // seeded all six equally could not tell that apart from grouping correctly.
    driver_employment_history: [
      { id: "emp-answered", driver_id: driverId(1), employer_name: "Kowlage Haulage",
        started_on: "2024-01-01", ended_on: "2025-06-30", dot_regulated: true },
      { id: "emp-open", driver_id: driverId(1), employer_name: "Rivergate Freight",
        started_on: "2025-07-01", ended_on: "2026-05-31", dot_regulated: true },
    ],
    employer_inquiries: [
      { driver_id: driverId(1), employment_id: "emp-answered", kind: "safety_performance",
        contacted_on: "2026-09-05", outcome: "responded" },
      // ⚠ §40.25, against the employer nobody has written to for §391.23(d). The service filters it
      // out, so `emp-open` stays outstanding. Without this row, deleting that filter reddens nothing
      // — measured by mutation on 2026-09-18.
      { driver_id: driverId(1), employment_id: "emp-open", kind: "drug_alcohol",
        contacted_on: "2026-09-06", outcome: "responded" },
    ],
    ...over,
  };
  return createSupabaseRecorder({
    tables: Object.fromEntries(
      Object.entries(rows).map(([name, list]) => [name, postgrestFixture(list.map(own))]),
    ),
  });
};

/** The same state as `seed` + `applicant(1)`, expressed as what the fold takes. */
const asInputs = (over: Record<string, unknown> = {}) => ({
  invitedAt: "2026-09-01T00:00:00Z",
  phases: {
    applicationSentAt: "2026-09-01T12:00:00Z",
    reviewRequestedAt: "2026-09-02T00:00:00Z",
    approvedAt: "2026-09-03T00:00:00Z",
    signingOpenedAt: "2026-09-08T00:00:00Z",
    submittedAt: null,
  },
  hasDraft: true,
  authorizations: authRows(driverId(1)),
  qualificationKinds: ["mvr", "psp_report"],
  psp: { requested: true, reportReceived: true },
  packetMarks: 0,
  // ⚠ `emp-open` has had no letter, so one employer is still outstanding. Q-HM9.
  investigation: { outstanding: 1, awaiting: 0 },
  hiredAt: null,
  ...over,
});

describe("the board row is the fold's answer, projected", () => {
  /**
   * ⚠ The assertion this file exists for. It reads the expected values OUT of the fold rather than
   * writing them down, so a projection that started deciding anything for itself — a `next` picked
   * by a different rule, a phase mapped by hand — shows up as a mismatch.
   */
  it("leads with the step the fold nominated, and the phase that step carries", async () => {
    const rec = seed();
    const board = await boardChecklists(rec.client, ORG, [applicant(1)], NOW);
    const fold = hiringChecklist(asInputs());
    const row = board.get(driverId(1))!;

    expect(row.next).toBe(fold.next);
    // ⚠ The ACTION, not the label. "Office approved it" is a completed fact and this column is an
    // instruction — see `HiringStepSpec.action` for the render that found it.
    expect(row.next_label).toBe(hiringStep(fold.next!).action);
    expect(row.next_label).not.toBe(hiringStep(fold.next!).label);
    expect(row.phase).toBe(hiringStep(fold.next!).phase);
    expect(row.done).toBe(fold.done);
    expect(row.total).toBe(fold.total);
  });

  /**
   * ⚠ Waiting-on comes off the fold's STATE, not the catalogue's `owes`, and PSP is the case that
   * tells them apart: the catalogue says the office owes a PSP report, and once one is ORDERED the
   * fold says `waiting_on_them` because the office has done its part and is chasing a vendor.
   */
  it("says THEM for a step the office has already acted on", async () => {
    // ⚠ The MVR is filed deliberately: it comes BEFORE psp in D-HM9's order, so without it the
    // nomination stops at the MVR and this test passes while never reaching the case it names —
    // the "fixture too uniform to discriminate" failure this repo has paid for repeatedly.
    const rec = seed({
      qualification_records: [
        { driver_id: driverId(1), kind: "mvr", created_at: "2026-09-04T00:00:00Z" },
      ],
      psp_requests: [{ id: "psp-1", driver_id: driverId(1) }],
    });
    const row = (await boardChecklists(rec.client, ORG, [applicant(1)], NOW)).get(driverId(1))!;
    expect(row.next).toBe("psp");
    // The catalogue says `owes: "us"` for a PSP report. The fold says the office has ordered one and
    // is now chasing a vendor, and the fold is the one the column reads.
    expect(hiringStep("psp").owes).toBe("us");
    expect(row.waiting_on).toBe("them");
  });

  it("says US for the same step when nothing has been ordered", async () => {
    const rec = seed({
      qualification_records: [
        { driver_id: driverId(1), kind: "mvr", created_at: "2026-09-04T00:00:00Z" },
      ],
      psp_requests: [],
    });
    const row = (await boardChecklists(rec.client, ORG, [applicant(1)], NOW)).get(driverId(1))!;
    expect(row.next).toBe("psp");
    expect(row.waiting_on).toBe("us");
  });

  /**
   * ⚠ The defect the board showed the first time it was LOOKED at, 2026-09-18. A declined applicant
   * sat at the top of the default "waiting on you" view, sixteen days stale, on a screen whose
   * whole question is *what is mine today*. Every test passed; the page already refused to print a
   * next action for them, and the filter counted them anyway.
   */
  it("says nobody for an application the carrier has already answered", async () => {
    const rec = seed();
    const board = await boardChecklists(rec.client, ORG, [applicant(1, { decided: true })], NOW);
    const row = board.get(driverId(1))!;
    expect(row.waiting_on).toBeNull();
    // ⚠ The steps are NOT rewritten — a declined applicant's checklist is still true about what is
    // outstanding, and their record page still shows it. Only the board's queue changes.
    expect(row.next).not.toBeNull();
    expect(row.done).toBeGreaterThan(0);
  });

  it("says nobody when there is nothing outstanding", async () => {
    const kinds = ["mvr", "clearinghouse_full", "drug_test", "medical_registry_verification", "road_test", "psp_report"];
    const rec = seed({
      qualification_records: kinds.map((kind) => ({
        driver_id: driverId(1), kind, created_at: "2026-09-06T00:00:00Z",
      })),
      application_packet_marks: driverPlacementIds(null).map((placement_id, i) => ({
        invitation_id: inviteId(1), created_at: "2026-09-07T00:00:00Z", id: `m${i}`, placement_id,
      })),
      // ⚠ Q-HM9: BOTH employers answered, so the §391.23 investigation is closed too. Without this
      // the default seed leaves `emp-open` unwritten-to and `next` is the investigation — which is
      // the step doing its job, and would make this test's "nothing outstanding" a false premise.
      employer_inquiries: ["emp-answered", "emp-open"].map((employment_id) => ({
        driver_id: driverId(1), employment_id, kind: "safety_performance",
        contacted_on: "2026-09-05", outcome: "responded",
      })),
    });
    const board = await boardChecklists(rec.client, ORG, [applicant(1, { hiredAt: "2026-09-08" })], NOW);
    const row = board.get(driverId(1))!;
    expect(row.next).toBeNull();
    expect(row.waiting_on).toBeNull();
    expect(row.phase).toBeNull();
  });

  /**
   * ⚠ Q-HM14: a company driver's packet is signed through at twenty (no p31b). The board folds with
   * the answer its caller read beside the draft flag — without it, this row would lead with
   * "Application signed" for ever, one stop short of the paper's twenty-one.
   */
  it("counts a company driver's packet against their own walk", async () => {
    const kinds = ["mvr", "clearinghouse_full", "drug_test", "medical_registry_verification", "road_test", "psp_report"];
    const rec = seed({
      qualification_records: kinds.map((kind) => ({
        driver_id: driverId(1), kind, created_at: "2026-09-06T00:00:00Z",
      })),
      application_packet_marks: driverPlacementIds("company_driver").map((placement_id, i) => ({
        invitation_id: inviteId(1), created_at: "2026-09-07T00:00:00Z", id: `m${i}`, placement_id,
      })),
      employer_inquiries: ["emp-answered", "emp-open"].map((employment_id) => ({
        driver_id: driverId(1), employment_id, kind: "safety_performance",
        contacted_on: "2026-09-05", outcome: "responded",
      })),
    });
    const row = async (applyingAs: "company_driver" | "owner_operator") =>
      (await boardChecklists(rec.client, ORG, [applicant(1, { hiredAt: "2026-09-08", applyingAs })], NOW))
        .get(driverId(1))!;
    expect((await row("company_driver")).next).toBeNull();
    expect((await row("owner_operator")).next).toBe("application_signed");
  });
});

describe("how long it has sat still", () => {
  /**
   * ⚠ Counted from the NEWEST evidence of any kind, not from the invitation. An applicant invited
   * in March whose drug test landed yesterday is not 180 days stale, and a column that said so is a
   * column a recruiter learns to ignore.
   */
  it("counts from the newest evidence, not from the invitation", async () => {
    const rec = seed({
      qualification_records: [
        { driver_id: driverId(1), kind: "mvr", created_at: "2026-09-16T00:00:00Z" },
      ],
    });
    const board = await boardChecklists(rec.client, ORG, [applicant(1)], NOW);
    // Invited on the 1st, MVR filed on the 16th, "now" is the 18th at noon.
    expect(board.get(driverId(1))!.last_progress_at).toBe("2026-09-16T00:00:00Z");
    expect(board.get(driverId(1))!.days_waiting).toBe(2);
  });

  it("falls back to the invitation when no other evidence has landed", async () => {
    const rec = seed({ qualification_records: [], psp_requests: [] });
    const board = await boardChecklists(
      rec.client,
      ORG,
      [applicant(1, { authorizations: [], invitation: {
        id: inviteId(1), created_at: "2026-09-10T00:00:00Z",
        application_sent_at: "2026-09-01T12:00:00Z",
        review_requested_at: null, approved_at: null, signing_opened_at: null, submitted_at: null,
      } })],
      NOW,
    );
    expect(board.get(driverId(1))!.days_waiting).toBe(8);
  });

  it("reads a move made this morning as zero days, never as one", async () => {
    const rec = seed({
      qualification_records: [
        { driver_id: driverId(1), kind: "mvr", created_at: "2026-09-18T08:00:00Z" },
      ],
    });
    const board = await boardChecklists(rec.client, ORG, [applicant(1)], NOW);
    expect(board.get(driverId(1))!.days_waiting).toBe(0);
  });
});

describe("what it reads, and how much", () => {
  it("scopes every read to the org the caller is in", async () => {
    const rec = seed();
    await boardChecklists(rec.client, ORG, [applicant(1)], NOW);
    expectOrgScoped(rec, ORG);
    expect(new Set(rec.queries.map((q) => q.table))).toEqual(
      new Set([
        "qualification_records", "psp_requests", "application_packet_marks",
        // Q-HM9's two: the declared employment history and the §391.23(c)(2) contact attempts.
        "driver_employment_history", "employer_inquiries",
      ]),
    );
  });

  /**
   * ⚠ **The property a one-applicant fixture cannot express.** Six applicants must still be five
   * queries, because the alternative — a loop over B3's round trips — is what
   * `LIVE-MAP-CONCURRENCY-PLAN.md` §7 measured as refusing a whole office, and it took #856–#858 to
   * undo. A board is the screen a recruiter leaves open all morning.
   *
   * ⚠ It was three until Q-HM9 and is five now. What the assertion protects is not the NUMBER — it
   * is that the number does not move with the applicant count, which is the whole difference between
   * a set-based read and an N+1. Six applicants folding the §391.23 investigation per driver would
   * read thirteen.
   */
  it("costs the same five queries for six applicants as for one", async () => {
    const one = seed();
    await boardChecklists(one.client, ORG, [applicant(1)], NOW);

    const many = seed();
    await boardChecklists(
      many.client,
      ORG,
      [1, 2, 3, 4, 5, 6].map((n) => applicant(n)),
      NOW,
    );
    expect(many.queries.length).toBe(one.queries.length);
    expect(many.queries.length).toBe(5);
  });

  /**
   * ⚠ Marks are keyed on the INVITATION, never the driver — 0339 scopes them that way because a
   * rehire signs their own packet. Two applicants here hold marks under different invitations, so a
   * count that fell back to the driver, or that forgot to group at all, gives one of them the
   * other's packet.
   */
  it("counts each applicant's marks against their own invitation", async () => {
    const rec = seed({
      // ⚠ Both applicants hold the SAME records and the same PSP order, so the marks are the only
      // thing that differs between them. A fixture where they differed in two ways could not say
      // which of the two the assertion was measuring.
      qualification_records: [1, 2].map((n) => ({
        driver_id: driverId(n), kind: "mvr", created_at: "2026-09-04T00:00:00Z",
      })),
      psp_requests: [],
      // ⚠ Q-HM9: cleared for BOTH, because the default seed gives driver 1 an employment history and
      // driver 2 none — which is a second difference between them, and this test can only measure
      // the marks if the marks are the only one. It cost a real failure here, not a hypothetical.
      driver_employment_history: [],
      employer_inquiries: [],
      application_packet_marks: [
        ...driverPlacementIds(null).map((placement_id, i) => ({
          invitation_id: inviteId(1), created_at: "2026-09-07T00:00:00Z", id: `a${i}`, placement_id,
        })),
        { invitation_id: inviteId(2), created_at: "2026-09-07T00:00:00Z", id: "b0", placement_id: "p03" },
      ],
    });
    const board = await boardChecklists(rec.client, ORG, [applicant(1), applicant(2)], NOW);
    // The two applicants are identical except for their marks, so the whole difference in what the
    // board says about them is that one packet is signed and the other is one mark in. A count that
    // fell back to the driver, or forgot to group, would make these equal.
    expect(board.get(driverId(1))!.done).toBe(board.get(driverId(2))!.done + 1);
  });

  /**
   * ⚠ L-1: a mark at page 4 from before the withdrawal is still a row. Applicant 2 holds as many ROWS
   * as applicant 1 — one of them at p04 — and is one real stop short, so the board must say so.
   */
  it("does not count a mark on a line withdrawn from signing", async () => {
    const current = driverPlacementIds(null);
    const rec = seed({
      qualification_records: [1, 2].map((n) => ({
        driver_id: driverId(n), kind: "mvr", created_at: "2026-09-04T00:00:00Z",
      })),
      psp_requests: [],
      driver_employment_history: [],
      employer_inquiries: [],
      application_packet_marks: [
        ...current.map((placement_id, i) => ({
          invitation_id: inviteId(1), created_at: "2026-09-07T00:00:00Z", id: `a${i}`, placement_id,
        })),
        ...["p04", ...current.slice(0, -1)].map((placement_id, i) => ({
          invitation_id: inviteId(2), created_at: "2026-09-07T00:00:00Z", id: `b${i}`, placement_id,
        })),
      ],
    });
    const board = await boardChecklists(rec.client, ORG, [applicant(1), applicant(2)], NOW);
    expect(board.get(driverId(1))!.done).toBe(board.get(driverId(2))!.done + 1);
  });

  it("does not read another org's evidence onto this org's board", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        qualification_records: postgrestFixture([
          { org_id: OTHER_ORG, driver_id: driverId(1), kind: "mvr", created_at: "2026-09-04T00:00:00Z" },
        ]),
        psp_requests: postgrestFixture([]),
        application_packet_marks: postgrestFixture([]),
      },
    });
    const board = await boardChecklists(rec.client, ORG, [applicant(1)], NOW);
    // The MVR belongs to another org, so this applicant's MVR step is still outstanding — and since
    // the Clearinghouse query has no prerequisite it is nominated first, MVR second.
    const fold = hiringChecklist(asInputs({ qualificationKinds: [], psp: { requested: false, reportReceived: false } }));
    expect(board.get(driverId(1))!.next).toBe(fold.next);
  });

  it("returns nothing, and asks nothing, for an empty board", async () => {
    const rec = seed();
    const board = await boardChecklists(rec.client, ORG, [], NOW);
    expect(board.size).toBe(0);
    expect(rec.queries.length).toBe(0);
  });
});
