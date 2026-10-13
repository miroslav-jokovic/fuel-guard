import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { readMedstopTestsForDriver } from "./personTests.js";
import { readResultReview } from "./results.js";

/**
 * MS2c's two readers (F-4/F-5). Pinned: a recruiter's answer carries NO result — the value never
 * leaves the API — while the DER's does; only a certain match is read; an order still waiting shows,
 * a completed one does not; a drug test not yet final has its "expected by"; and the review splits
 * news the DER was told of from history the first read found.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";

const db = () =>
  createSupabaseRecorder({
    tables: {
      medstop_credentials: [{ base_url: "https://api.med-stop.com", enabled: true, api_key_sealed: "sealed", key_expires_on: null, last_synced_at: null, last_error: null }],
      medstop_employees: [{ medstop_id: "e1", roster: "active" }],
      medstop_tests: [
        { medstop_id: "t2", service: "TD", reason: "PRE-EMPLOYMENT", status: "AT LAB", result: null, collected_local: "2026-10-09T14:24:00" },
        { medstop_id: "t1", service: "TD", reason: "PRE-EMPLOYMENT", status: "CLOSED", result: "NEGATIVE", collected_local: "2026-09-01T09:00:00" },
      ],
      medstop_requests: [
        { medstop_id: "r3", service: "TD", reason: "PRE-EMPLOYMENT", status: "OPEN", requested_local: "2026-10-12T16:00:00", test_medstop_id: null },
        { medstop_id: "r2", service: "TD", reason: "PRE-EMPLOYMENT", status: "COMPLETED", requested_local: "2026-10-08T16:00:00", test_medstop_id: "t2" },
      ],
    },
  });

describe("readMedstopTestsForDriver", () => {
  it("a recruiter sees the stage and the date the result is due — and no result at all", async () => {
    const r = db();
    const view = await readMedstopTestsForDriver(r.client, ORG, DRIVER, "recruiter");
    expect(view).toMatchObject({ connected: true, matched: true, outcomesVisible: false });
    expect(view.orders).toEqual([{ requestId: "r3", kind: "drug", reason: "PRE-EMPLOYMENT", requestedOn: "2026-10-12", status: "OPEN" }]);
    expect(view.tests[0]).toEqual({ testId: "t2", kind: "drug", reason: "PRE-EMPLOYMENT", stage: "At the lab", collectedOn: "2026-10-09", expectedOn: "2026-10-13", outcome: null });
    expect(view.tests[1]).toMatchObject({ testId: "t1", stage: "Result reported", expectedOn: null, outcome: null });
    expect(JSON.stringify(view)).not.toMatch(/NEGATIVE|negative/);
  });

  it("the DER sees the result", async () => {
    const view = await readMedstopTestsForDriver(db().client, ORG, DRIVER, "safety_manager");
    expect(view.outcomesVisible).toBe(true);
    expect(view.tests.map((t) => t.outcome)).toEqual(["pending", "negative"]);
  });

  it("reads only a certain match, scoped to the org", async () => {
    const r = db();
    await readMedstopTestsForDriver(r.client, ORG, DRIVER, "admin");
    expect(r.forTable("medstop_employees")[0]!.filters()).toContainEqual({ col: "match_rule", val: ["licence", "name_dob"] });
    expectOrgScoped(r, ORG);
  });

  it("names the applicant-roster id a pre-employment order is placed on, and none for a person on the active roster", async () => {
    expect((await readMedstopTestsForDriver(db().client, ORG, DRIVER, "recruiter")).applicantMedstopId).toBeNull();
    const r = createSupabaseRecorder({ tables: { medstop_credentials: [], medstop_employees: [{ medstop_id: "e1", roster: "active" }, { medstop_id: "e2", roster: "applicant" }] } });
    expect((await readMedstopTestsForDriver(r.client, ORG, DRIVER, "recruiter")).applicantMedstopId).toBe("e2");
  });

  it("a person Med-Stop does not hold is 'not matched', not an empty history", async () => {
    const r = createSupabaseRecorder({ tables: { medstop_credentials: [], medstop_employees: [] } });
    expect(await readMedstopTestsForDriver(r.client, ORG, DRIVER, "admin")).toEqual({ connected: false, matched: false, applicantMedstopId: null, orders: [], tests: [], outcomesVisible: true });
    expect(r.forTable("medstop_tests")).toHaveLength(0);
  });
});

describe("readResultReview", () => {
  it("news the DER was told of is 'recent'; violations the first read found are 'history'; the rest is neither", async () => {
    const r = createSupabaseRecorder({
      tables: {
        medstop_tests: [
          { medstop_id: "a", employee_medstop_id: "e1", service: "TD", reason: "RANDOM", status: "CLOSED", result: "POSITIVE", collected_local: "2026-10-09T09:00:00", baseline: false },
          { medstop_id: "b", employee_medstop_id: "e1", service: "TD", reason: "RANDOM", status: "CLOSED", result: "NEGATIVE - DILUTE", collected_local: "2026-10-01T09:00:00", baseline: false },
          { medstop_id: "c", employee_medstop_id: "e1", service: "TD", reason: "RANDOM", status: "CLOSED", result: "NEGATIVE", collected_local: "2026-09-01T09:00:00", baseline: false },
          { medstop_id: "d", employee_medstop_id: "e2", service: "TD", reason: "PRE-EMPLOYMENT", status: "CLOSED", result: "POSITIVE", collected_local: "2026-02-01T09:00:00", baseline: true },
          { medstop_id: "e", employee_medstop_id: "e2", service: "TD", reason: "RANDOM", status: "CLOSED", result: "NEGATIVE - DILUTE", collected_local: "2026-02-01T09:00:00", baseline: true },
        ],
      },
    });
    const personOf = (id: string | null) => ({ driverId: null, medstopId: id, name: `P ${id}` });
    const review = await readResultReview(r.client, ORG, "2025-10-12", personOf);
    expect(review.recent.map((x) => [x.testId, x.outcome])).toEqual([["a", "positive"], ["b", "negative_dilute"]]);
    expect(review.history.map((x) => [x.testId, x.outcome])).toEqual([["d", "positive"]]);
    expect(r.forTable("medstop_tests")[0]!.ops).toContainEqual({ method: "gte", args: ["collected_local", "2025-10-12"] });
    expectOrgScoped(r, ORG);
  });
});
