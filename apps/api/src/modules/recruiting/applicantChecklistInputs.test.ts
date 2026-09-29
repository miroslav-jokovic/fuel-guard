import { describe, expect, it } from "vitest";
import { APPLICATION_RELEASE_ORDER, driverPlacements } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../testing/postgrestFixture.js";
import { applicantChecklist, isChecklistError } from "./applicantChecklist.js";
import { boardChecklists } from "./applicantBoard.js";

/**
 * G-7 (APPLICATION-FLOW-V2-PLAN §3.3): the board and the drawer fold ONE builder's input.
 *
 * Until 2026-09-26 each built its own, and they had drifted — the board had no road-test pass flag
 * (A-8) and no ceremony-closed stamp (A-4). So the property pinned here is parity, measured on the
 * two states that used to split them: the same fixture, read through both doors, must give the same
 * `next` and the same `done`. And the reads page past PostgREST's 1,000-row answer.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "d0000000-0000-4000-8000-000000000001";
const INVITE = "10000000-0000-4000-8000-000000000001";
const TODAY = "2026-09-26";

const INVITATION = {
  id: INVITE, driver_id: DRIVER, created_at: "2026-09-01T00:00:00Z", revoked_at: null,
  releases_completed_at: null, application_sent_at: null, review_requested_at: null, approved_at: null,
  signing_opened_at: null, submitted_at: null,
};
const ALL_SIGNED = APPLICATION_RELEASE_ORDER.map((purpose, i) => ({
  id: `a${i}`, driver_id: DRIVER, purpose, accepted_at: "2026-09-02T00:00:00Z", revokes: null,
}));

const seed = (opts: {
  records?: Array<Record<string, unknown>>;
  invitation?: Record<string, unknown>;
  authorizations?: Array<Record<string, unknown>>;
  intakes?: Array<Record<string, unknown>>;
  trips?: Array<Record<string, unknown>>;
  licences?: Array<Record<string, unknown>>;
  drafts?: Array<Record<string, unknown>>;
  packetMarks?: Array<Record<string, unknown>>;
}) => {
  const org = (rows: Array<Record<string, unknown>>) => rows.map((r) => ({ org_id: ORG, ...r }));
  return createSupabaseRecorder({
    tables: {
      drivers: postgrestFixture(org([{ id: DRIVER, hire_date: null }])),
      application_invitations: postgrestFixture(org([{ ...INVITATION, ...opts.invitation }])),
      driver_authorizations: postgrestFixture(org(opts.authorizations ?? ALL_SIGNED)),
      qualification_records: postgrestFixture(org(opts.records ?? [])),
      psp_requests: postgrestFixture([]),
      application_packet_marks: postgrestFixture(org(opts.packetMarks ?? [])),
      application_drafts: postgrestFixture(org(opts.drafts ?? [{ id: "dr1", invitation_id: INVITE, payload: {} }])),
      driver_employment_history: postgrestFixture([]),
      employer_inquiries: postgrestFixture([]),
      handbook_marks: postgrestFixture([]),
      application_intakes: postgrestFixture(org(opts.intakes ?? [])),
      applicant_travel: postgrestFixture(org(opts.trips ?? [])),
      application_intake_licences: postgrestFixture(org(opts.licences ?? [])),
      organizations: postgrestFixture([{ id: ORG, operating_hours: { tz: "America/Chicago" } }]),
    },
  });
};

/** Both doors over one fixture: the drawer's checklist, and the board's row for the same person. */
async function bothDoors(opts: Parameters<typeof seed>[0]) {
  const drawer = await applicantChecklist(seed(opts).client, ORG, DRIVER, TODAY);
  if (isChecklistError(drawer)) throw new Error("expected a checklist");
  const inv = { ...INVITATION, ...opts.invitation };
  const { checklists } = await boardChecklists(
    seed(opts).client, ORG,
    [{ driverId: DRIVER, hiredAt: null, invitation: inv, authorizations: (opts.authorizations ?? ALL_SIGNED) as never, decided: false }],
    new Date(`${TODAY}T12:00:00Z`),
  );
  return { drawer, board: checklists.get(DRIVER)! };
}

describe("the board and the drawer fold the same input", () => {
  /**
   * §7 (C2b2): Part 1 and the trip, read once for both doors. A v2 link whose Part 1 is finished, and
   * a trip that was CANCELLED — 0376 keeps the row, and a read that dropped the `cancelled_at` filter
   * would book this applicant on both doors at once, which parity alone could never catch.
   */
  it("§7: reads Part 1 from its row and stamp, and a cancelled trip counts on neither", async () => {
    const gates = ["mvr", "clearinghouse_full", "drug_test", "medical_registry_verification", "psp_report"];
    const { drawer, board } = await bothDoors({
      invitation: { intake_completed_at: "2026-09-01T06:00:00Z", application_sent_at: "2026-09-03T00:00:00Z", review_requested_at: "2026-09-04T00:00:00Z" },
      intakes: [{ id: "in1", invitation_id: INVITE }],
      records: gates.map((kind, i) => ({ id: `r${i}`, driver_id: DRIVER, kind, created_at: "2026-09-10T00:00:00Z", occurred_on: "2026-09-10" })),
      trips: [{ id: "t1", invitation_id: INVITE, cancelled_at: "2026-09-20T00:00:00Z" }],
    });
    expect(drawer.steps.find((s) => s.key === "intake_completed")!.state).toBe("done");
    expect(drawer.steps.find((s) => s.key === "travel_booked")!.state).toBe("waiting_on_us");
    expect(board.done).toBe(drawer.done);
    expect(board.next).toBe(drawer.next);
  });


  it("A-8: a road test recorded as FAILED counts on neither", async () => {
    const gates = ["mvr", "clearinghouse_full", "drug_test", "medical_registry_verification", "psp_report"];
    const { drawer, board } = await bothDoors({
      records: [
        ...gates.map((kind, i) => ({ id: `r${i}`, driver_id: DRIVER, kind, created_at: "2026-09-10T00:00:00Z", occurred_on: "2026-09-10" })),
        // Recorded by the generic door before A-9 closed it: a result, and not a pass.
        { id: "rt", driver_id: DRIVER, kind: "road_test", created_at: "2026-09-11T00:00:00Z", detail: { passed: false } },
      ],
    });
    expect(drawer.steps.find((s) => s.key === "road_test")!.state).not.toBe("done");
    expect(board.done).toBe(drawer.done);
    expect(board.next).toBe(drawer.next);
  });

  it("A-4: a closed ceremony's missing permissions are the office's on both", async () => {
    const four = APPLICATION_RELEASE_ORDER.filter((p) => p !== "mvr" && p !== "clearinghouse").map((purpose, i) => ({
      id: `a${i}`, driver_id: DRIVER, purpose, accepted_at: "2026-09-02T00:00:00Z", revokes: null,
    }));
    const { drawer, board } = await bothDoors({
      invitation: { releases_completed_at: "2026-09-02T00:05:00Z" },
      authorizations: four,
    });
    const row = drawer.steps.find((s) => s.key === "permissions_signed")!;
    expect(row.state).toBe("waiting_on_us");
    expect(row.paperOnlyPurposes).toEqual(["mvr", "clearinghouse"]);
    expect(board.next).toBe("permissions_signed");
    expect(board.waiting_on).toBe("us");
  });

  /**
   * AW7 (C2b3): the licences an MVR is owed for come from Part 1's list first — never pruned, and the
   * applicant's own answer to "every licence in three years" — so a draft that names only Illinois
   * cannot talk the step out of Wisconsin's record. On both doors.
   */
  it("AW7: owes an MVR for every Part 1 licence, whatever the draft says, on both", async () => {
    const { drawer, board } = await bothDoors({
      invitation: { intake_completed_at: "2026-09-10T15:00:00Z" },
      intakes: [{ id: "in1", invitation_id: INVITE }],
      licences: [
        { id: "l2", invitation_id: INVITE, position: 1, state_code: "WI" },
        { id: "l1", invitation_id: INVITE, position: 0, state_code: "IL" },
      ],
      drafts: [{ id: "dr1", invitation_id: INVITE, payload: { cdl_state: "IL" } }],
      records: [{ id: "m1", driver_id: DRIVER, kind: "mvr", created_at: "2026-09-12T00:00:00Z", occurred_on: "2026-09-12", detail: { jurisdiction: "IL" } }],
    });
    const mvr = drawer.steps.find((s) => s.key === "mvr")!;
    expect(mvr.state).toBe("waiting_on_us");
    expect(mvr.outstandingJurisdictions).toEqual(["WI"]);
    expect(board.done).toBe(drawer.done);
    expect(board.next).toBe(drawer.next);
  });

  /**
   * G-3 (C2b3): an MVR dated more than thirty carrier days before Part 1 finished is somebody else's
   * hire. Part 1 finished at 03:00 UTC on 09-11 — still 09-10 in Chicago — so the floor is 08-11, and
   * a UTC reading would have put it a day later and refused the 08-11 record.
   */
  it("G-3: counts an MVR from the thirty carrier days before Part 1, and not one older, on both", async () => {
    const at = (occurred_on: string) => bothDoors({
      invitation: { intake_completed_at: "2026-09-11T03:00:00Z" },
      intakes: [{ id: "in1", invitation_id: INVITE }],
      records: [{ id: "m1", driver_id: DRIVER, kind: "mvr", created_at: "2026-09-12T00:00:00Z", occurred_on }],
    });
    const stale = await at("2026-08-10");
    expect(stale.drawer.steps.find((s) => s.key === "mvr")!.state).not.toBe("done");
    expect(stale.board.done).toBe(stale.drawer.done);
    const fresh = await at("2026-08-11");
    expect(fresh.drawer.steps.find((s) => s.key === "mvr")!.state).toBe("done");
    expect(fresh.board.done).toBe(fresh.drawer.done);
  });

  /**
   * D-AW16 (C3s4b): the envelope opens the handbook, so a filed application whose envelope was sent has
   * a handbook in the driver's hands — theirs to sign — with no second opening at the desk.
   */
  it("D-AW16: a filed application's handbook is the driver's to sign on the envelope alone, on both", async () => {
    const { drawer, board } = await bothDoors({
      invitation: {
        releases_completed_at: "2026-09-02T00:00:00Z", approved_at: "2026-09-20T00:00:00Z",
        signing_opened_at: "2026-09-25T09:00:00Z", submitted_at: "2026-09-25T10:00:00Z",
      },
      packetMarks: driverPlacements(null).map((p) => ({ invitation_id: INVITE, placement_id: p.id, driver_id: DRIVER })),
    });
    expect(drawer.steps.find((s) => s.key === "application_signed")!.state).toBe("done");
    expect(drawer.steps.find((s) => s.key === "handbook")!.state).toBe("waiting_on_them");
    expect(board.next).toBe(drawer.next);
  });

  it("reads past PostgREST's 1,000-row answer, and scopes every page to the org", async () => {
    // 1,000 unrelated rows first, then the MVR: an unpaged read stops at row 1,000 and never sees it.
    const noise = Array.from({ length: 1000 }, (_, i) => ({
      id: `n${String(i).padStart(4, "0")}`, org_id: ORG, driver_id: DRIVER, kind: "annual_mvr_review", created_at: "2026-09-01T00:00:00Z",
    }));
    const mvr = { id: "z-mvr", org_id: ORG, driver_id: DRIVER, kind: "mvr", created_at: "2026-09-12T00:00:00Z", occurred_on: "2026-09-12" };
    const all = [...noise, mvr];
    const paged = createSupabaseRecorder({
      tables: {
        ...Object.fromEntries(["drivers", "application_invitations", "driver_authorizations", "application_drafts"].map(
          (t) => [t, (q: RecordedQuery) => seedTable(t, q)],
        )),
        // PostgREST's own behaviour: a page of at most 1,000, cut where `.range()` says.
        qualification_records: (q: RecordedQuery) => {
          const range = q.ops.find((o) => o.method === "range");
          const [from, to] = (range?.args ?? [0, 999]) as [number, number];
          return all.slice(from, Math.min(to, from + 999) + 1);
        },
      },
    });
    const drawer = await applicantChecklist(paged.client, ORG, DRIVER, TODAY);
    if (isChecklistError(drawer)) throw new Error("expected a checklist");
    expect(drawer.steps.find((s) => s.key === "mvr")!.state).toBe("done");
    expect(paged.forTable("qualification_records")).toHaveLength(2);
    expectOrgScoped(paged, ORG);
  });
});

/** The four subject tables of `seed({})`, answered by filter — for the paging test's own recorder. */
function seedTable(table: string, q: RecordedQuery) {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    drivers: [{ id: DRIVER, org_id: ORG, hire_date: null }],
    application_invitations: [{ ...INVITATION, org_id: ORG }],
    driver_authorizations: ALL_SIGNED.map((r) => ({ ...r, org_id: ORG })),
    application_drafts: [{ id: "dr1", org_id: ORG, invitation_id: INVITE, payload: {} }],
  };
  return postgrestFixture(rows[table] ?? [])(q);
}
