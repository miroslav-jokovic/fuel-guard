import { describe, it, expect } from "vitest";
import { hiringChecklist, packetDriverMarkCount, APPLICATION_RELEASE_ORDER } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../testing/postgrestFixture.js";
import { applicantChecklist, isChecklistError } from "./applicantChecklist.js";

/**
 * Gathering the evidence one applicant's checklist folds over (B3).
 *
 * Two properties carry this file, and neither can be checked anywhere else:
 *
 *   · **the endpoint's answer IS the fold's answer.** Every rule lives in `packages/shared`, so the
 *     only thing that can go wrong here is reading the wrong column — and the test that catches that
 *     is one that builds the same state twice, once as database rows and once as fold inputs, and
 *     demands they agree. An assertion that checked the states by hand would be a second copy of the
 *     rules, in the place this module exists not to have them.
 *   · **the tenant scope is explicit.** The API reads with the service role, which BYPASSES RLS, and
 *     seven reads is seven chances to leave an `org_id` off.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INVITE = "11111111-2222-4333-8444-555555555555";

/**
 * ⚠ **`supabaseRecorder` does not apply filters, order or limit** — a flat fixture hands every row
 * back to every query, so a service that forgot `.eq("invitation_id", …)` or `.order(…)` would pass
 * a test written against one. Two of the properties below are precisely about narrowing (the live
 * invitation, and marks counted against it), so they are only real if the fake narrows.
 *
 * `postgrestFixture` is that fake, and it moved to `src/testing/` in B4 so the board's test and this
 * one cannot come to disagree about which one PostgREST is. Its header carries the two green
 * assertions that proved nothing before it existed.
 */
const table = postgrestFixture;

const own = (row: Record<string, unknown>) => ({ org_id: ORG, ...row });

const authRows = () =>
  APPLICATION_RELEASE_ORDER.map((purpose, i) => ({
    id: `auth-${i}`,
    purpose,
    accepted_at: "2026-09-01T00:00:00Z",
    revokes: null,
  }));

const markRows = (n: number, invitation = INVITE) =>
  Array.from({ length: n }, (_, i) => ({ id: `mark-${invitation}-${i}`, invitation_id: invitation }));

/**
 * ⚠ A fixed date, passed in, and not `new Date()` (Q-HM9). The §391.23(a)(2) window is measured from
 * the hire date or — for an applicant, which is every fixture here — from today, so a test that let
 * the service read the clock would be a test whose employment fixtures aged out of the window on a
 * date nobody chose. The seed's dates below are positioned against THIS day.
 */
const TODAY = "2026-09-18";

/**
 * Two DOT-regulated previous employers inside the three-year window, and one earlier job outside it.
 *
 * ⚠ The third row is the one that makes this fixture discriminate rather than merely pass. A seed
 * with only owed employers cannot tell a service that folds the window correctly from one that
 * counts every employment row it can see — which is exactly the "fixture too uniform to discriminate"
 * failure this file's own header names.
 */
const employmentRows = () => [
  { id: "emp-answered", driver_id: DRIVER, employer_name: "Kowlage Haulage",
    started_on: "2024-01-01", ended_on: "2025-06-30", dot_regulated: true },
  { id: "emp-open", driver_id: DRIVER, employer_name: "Rivergate Freight",
    started_on: "2025-07-01", ended_on: "2026-05-31", dot_regulated: true },
  // Outside the §391.23(a)(2) three-year window, so no inquiry is owed on it.
  { id: "emp-old", driver_id: DRIVER, employer_name: "Ninth Street Cartage",
    started_on: "2015-01-01", ended_on: "2016-01-01", dot_regulated: true },
];

/**
 * One letter sent, and answered. `emp-open` has had none, so one employer is still outstanding.
 *
 * ⚠ The second row is `drug_alcohol` AGAINST `emp-open`, and it is the whole reason this fixture
 * discriminates. §40.25 drug-and-alcohol inquiries apply to non-FMCSA DOT safety-sensitive
 * employment only — §391.23(e) routes FMCSA carriers to the Clearinghouse — so the service filters
 * them out, and `emp-open` must still read as nobody-has-written-to-them. **Without this row,
 * deleting the `kind` filter from the service changed no test's answer**: measured by mutation on
 * 2026-09-18, it came back green and proved nothing. With it, dropping the filter makes `emp-open`
 * look answered and the count goes wrong.
 */
const inquiryRows = () => [
  { driver_id: DRIVER, employment_id: "emp-answered", kind: "safety_performance",
    contacted_on: "2026-09-05", outcome: "responded" },
  { driver_id: DRIVER, employment_id: "emp-open", kind: "drug_alcohol",
    contacted_on: "2026-09-06", outcome: "responded" },
];

/** One applicant, mid-flow: approved, three screening records in, packet half-signed. */
const seed = (over: Record<string, Array<Record<string, unknown>>> = {}) => {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    drivers: [{ id: DRIVER, hire_date: null }],
    application_invitations: [
      {
        id: INVITE,
        driver_id: DRIVER,
        created_at: "2026-09-01T00:00:00Z",
        application_sent_at: "2026-09-01T12:00:00Z",
        review_requested_at: "2026-09-02T00:00:00Z",
        approved_at: "2026-09-03T00:00:00Z",
        submitted_at: null,
      },
    ],
    application_drafts: [{ invitation_id: INVITE }],
    driver_authorizations: authRows().map((r) => ({ ...r, driver_id: DRIVER })),
    qualification_records: [
      { driver_id: DRIVER, kind: "mvr" },
      { driver_id: DRIVER, kind: "drug_test" },
      { driver_id: DRIVER, kind: "psp_report" },
    ],
    psp_requests: [{ id: "psp-1", driver_id: DRIVER }],
    application_packet_marks: markRows(3),
    driver_employment_history: employmentRows(),
    employer_inquiries: inquiryRows(),
    ...over,
  };
  return createSupabaseRecorder({
    tables: Object.fromEntries(
      Object.entries(rows).map(([name, list]) => [name, table(list.map(own))]),
    ),
  });
};

/** The same state, expressed as what the fold takes. Kept beside `seed` so the two stay in step. */
const asInputs = (over: Record<string, unknown> = {}) => ({
  invitedAt: "2026-09-01T00:00:00Z",
  phases: {
    applicationSentAt: "2026-09-01T12:00:00Z",
    reviewRequestedAt: "2026-09-02T00:00:00Z",
    approvedAt: "2026-09-03T00:00:00Z",
    submittedAt: null,
  },
  hasDraft: true,
  authorizations: authRows(),
  qualificationKinds: ["mvr", "drug_test", "psp_report"],
  psp: { requested: true, reportReceived: true },
  packetMarks: 3,
  // ⚠ `outstanding: 1` is `emp-open` — the employer nobody has written to. `emp-answered` is closed
  // and `emp-old` is outside the window, so neither is owed. Q-HM9.
  investigation: { outstanding: 1, awaiting: 0 },
  hiredAt: null,
  ...over,
});

describe("the endpoint answers exactly what the fold answers", () => {
  /**
   * ⚠ **The assertion this file exists for** (B3's done-when, in as many words). It compares whole
   * objects rather than picking states out, so a column read wrongly shows up as a difference no
   * matter which step it belongs to — and no rule is restated here to be got wrong separately.
   */
  it("matches the fold for the same rows, step for step", async () => {
    const rec = seed();
    const result = await applicantChecklist(rec.client, ORG, DRIVER, TODAY);
    expect(isChecklistError(result)).toBe(false);
    expect(result).toEqual(hiringChecklist(asInputs()));
  });

  /** And it must keep matching as the evidence changes, or the comparison above proves one case. */
  it("matches the fold for an applicant nobody has invited", async () => {
    const rec = seed({
      application_invitations: [],
      application_drafts: [],
      driver_authorizations: [],
      qualification_records: [],
      psp_requests: [],
      application_packet_marks: [],
    });
    const result = await applicantChecklist(rec.client, ORG, DRIVER, TODAY);
    expect(result).toEqual(
      hiringChecklist({
        invitedAt: null,
        phases: null,
        hasDraft: false,
        authorizations: [],
        qualificationKinds: [],
        psp: { requested: false, reportReceived: false },
        packetMarks: 0,
        hiredAt: null,
      }),
    );
  });

  it("matches the fold for a finished hire", async () => {
    const kinds = [
      "mvr", "clearinghouse_full", "drug_test", "medical_registry_verification",
      "road_test", "psp_report",
    ];
    const rec = seed({
      drivers: [{ id: DRIVER, hire_date: "2026-09-10" }],
      qualification_records: kinds.map((kind) => ({ driver_id: DRIVER, kind })),
      application_packet_marks: markRows(packetDriverMarkCount()),
    });
    const result = await applicantChecklist(rec.client, ORG, DRIVER, TODAY);
    expect(result).toEqual(
      hiringChecklist(asInputs({
        qualificationKinds: kinds,
        packetMarks: packetDriverMarkCount(),
        hiredAt: "2026-09-10",
      })),
    );
  });
});

describe("what it reads, and from where", () => {
  /**
   * ⚠ The service role bypasses RLS, so every read has to carry its own org filter — and
   * `expectOrgScoped` checks the queries that were MADE, which is why the table set is asserted
   * beside it. A service that read six tables instead of nine would pass the scope check by doing
   * less, and the first assertion alone could not tell that apart from doing it right.
   */
  it("scopes every read to the org the caller is in", async () => {
    const rec = seed();
    await applicantChecklist(rec.client, ORG, DRIVER, TODAY);
    expectOrgScoped(rec, ORG);
    // ⚠ And that it read all nine, so a scope check over six queries cannot pass by reading less.
    // ⚠ The last two are Q-HM9's: the §391.23 investigation needs the declared employment history
    // AND the contact attempts, and reading only one of them would silently fold the wrong answer
    // rather than fail — an empty history reads as "nothing owed", which is the trap the fold's own
    // `historyDeclared` guard exists for.
    expect(new Set(rec.queries.map((q) => q.table))).toEqual(new Set([
      "drivers", "application_invitations", "driver_authorizations", "qualification_records",
      "psp_requests", "application_packet_marks", "application_drafts",
      "driver_employment_history", "employer_inquiries",
    ]));
  });

  /**
   * ⚠ The 404 is a MEMBERSHIP check, not a lookup miss: the service role would read another org's
   * driver perfectly happily, and everything after this point believes the driver is ours.
   */
  it("refuses a driver who belongs to another org, and reads nothing else", async () => {
    const rec = seed({ drivers: [] });
    const result = await applicantChecklist(rec.client, ORG, DRIVER, TODAY);
    expect(isChecklistError(result)).toBe(true);
    // One query: the membership check that failed. Nothing about this applicant was gathered.
    expect(rec.queries).toHaveLength(1);
  });

  /**
   * ⚠ The LIVE invitation is the newest one. A rehire has two — 0337 is explicit the applications
   * must not merge — and folding the older one would report last spring's progress as this week's.
   */
  it("folds the newest invitation when a driver has more than one", async () => {
    const rec = seed({
      application_invitations: [
        {
          id: "old-invite", driver_id: DRIVER, created_at: "2025-01-01T00:00:00Z",
          application_sent_at: "2026-09-01T12:00:00Z",
          review_requested_at: "2025-01-02T00:00:00Z", approved_at: "2025-01-03T00:00:00Z",
          submitted_at: "2025-01-04T00:00:00Z",
        },
        {
          id: INVITE, driver_id: DRIVER, created_at: "2026-09-01T00:00:00Z",
          application_sent_at: "2026-09-01T12:00:00Z",
          review_requested_at: null, approved_at: null, submitted_at: null,
        },
      ],
    });
    const result = await applicantChecklist(rec.client, ORG, DRIVER, TODAY);
    expect(isChecklistError(result)).toBe(false);
    const steps = (result as { steps: Array<{ key: string; state: string }> }).steps;
    // The new link has not been sent to the office, so the application is NOT filled in — which the
    // old, certified invitation would have reported as done.
    expect(steps.find((s) => s.key === "application_filled")!.state).toBe("waiting_on_them");
  });

  /**
   * ⚠ **A REVOKED invitation is not the live one, and until B4 this read it as one.**
   * `applicationIntake`'s `resolveInvitation` treats a revoked row as a dead link and the pipeline
   * behind the board has always skipped them — so a recruiter who revoked a link and sent nothing
   * else saw the board fall back to the older application while this endpoint kept describing the
   * dead one. Two surfaces, one person, two answers: D-HM2's failure by name.
   */
  it("ignores a revoked invitation and folds the live one underneath it", async () => {
    const rec = seed({
      application_invitations: [
        {
          id: INVITE, driver_id: DRIVER, created_at: "2026-09-01T00:00:00Z",
          application_sent_at: "2026-09-01T12:00:00Z",
          review_requested_at: "2026-09-02T00:00:00Z", approved_at: "2026-09-03T00:00:00Z",
          submitted_at: null, revoked_at: null,
        },
        {
          id: "revoked-invite", driver_id: DRIVER, created_at: "2026-09-20T00:00:00Z",
          application_sent_at: "2026-09-01T12:00:00Z",
          review_requested_at: null, approved_at: null, submitted_at: null,
          revoked_at: "2026-09-21T00:00:00Z",
        },
      ],
    });
    const result = await applicantChecklist(rec.client, ORG, DRIVER, TODAY);
    expect(isChecklistError(result)).toBe(false);
    const steps = (result as { steps: Array<{ key: string; state: string }> }).steps;
    // The revoked row is the NEWEST and has no stamps at all, so reading it would report an
    // application nobody had filled in and an office that had approved nothing.
    expect(steps.find((s) => s.key === "application_filled")!.state).toBe("done");
    expect(steps.find((s) => s.key === "office_approved")!.state).toBe("done");
  });

  /**
   * ⚠ Keyed on the INVITATION, never the driver. `application_packet_marks` is invitation-scoped for
   * 0339's reason — a rehire signs their own packet — and a driver-keyed count would add last year's
   * twenty-two to this year's none.
   */
  it("counts packet marks against the live invitation only", async () => {
    const rec = seed({
      application_packet_marks: [...markRows(2), ...markRows(packetDriverMarkCount(), "old-invite")],
    });
    const result = await applicantChecklist(rec.client, ORG, DRIVER, TODAY);
    expect(result).toEqual(hiringChecklist(asInputs({ packetMarks: 2 })));
  });

  /**
   * ⚠ D-HM6 and D-HUI5 together: a PSP bought on FMCSA's portal and filed by hand ticks this step
   * exactly as an ordered one does, because what the fold reads is the filed RECORD. A step that
   * only counted our own orders would nag an office that had already done the work.
   */
  it("counts a PSP filed from the portal, with no order behind it", async () => {
    const rec = seed({ psp_requests: [] });
    const result = await applicantChecklist(rec.client, ORG, DRIVER, TODAY);
    const steps = (result as { steps: Array<{ key: string; state: string }> }).steps;
    expect(steps.find((s) => s.key === "psp")!.state).toBe("done");
  });

  /** An order with nothing back yet is the middle state — chase it, do not do it again. */
  it("shows an ordered PSP with no report as outstanding", async () => {
    const rec = seed({
      qualification_records: [{ driver_id: DRIVER, kind: "mvr" }, { driver_id: DRIVER, kind: "drug_test" }],
    });
    const result = await applicantChecklist(rec.client, ORG, DRIVER, TODAY);
    const steps = (result as { steps: Array<{ key: string; state: string }> }).steps;
    expect(steps.find((s) => s.key === "psp")!.state).toBe("waiting_on_them");
  });

  /**
   * ⚠ Whole authorization rows, because 0215 revokes by writing a NEW row rather than mutating one.
   * A read that selected `purpose` alone would report a revoked release as live.
   */
  it("honours a revoked release rather than counting the grant it cancelled", async () => {
    const rows = authRows().map((r) => ({ ...r, driver_id: DRIVER }));
    const rec = seed({
      driver_authorizations: [
        ...rows,
        {
          id: "revoke-1", driver_id: DRIVER, purpose: rows[0]!.purpose,
          accepted_at: "2026-09-05T00:00:00Z", revokes: rows[0]!.id,
        },
      ],
    });
    const result = await applicantChecklist(rec.client, ORG, DRIVER, TODAY);
    const steps = (result as { steps: Array<{ key: string; state: string }> }).steps;
    expect(steps.find((s) => s.key === "permissions_signed")!.state).toBe("waiting_on_them");
  });
});
