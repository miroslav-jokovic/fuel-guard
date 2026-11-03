import { describe, it, expect } from "vitest";
import { hiringChecklist, type HiringChecklistInputs, type HiringStep } from "./hiringChecklist.js";
import { hiringChecklistRows, nextStepOf, rowOfStep, rowState } from "./hiringChecklistRows.js";
import { HIRE_REFUSES_WITHOUT, HIRING_STEPS } from "./hiringSteps.js";
import { APPLICATION_RELEASE_ORDER } from "./applicationIntake.js";
import { packetDriverMarkCount } from "./packetPlacements.js";

/**
 * The checklist as the office reads it (HIRING-WORKFLOW-AUDIT §14, D-OF1..D-OF5, owner 2026-11-03).
 * Built over the REAL catalogue and the real fold, so a step moved or merged in `hiringSteps.ts` is
 * what these assertions read.
 */

const ALL_PERMISSIONS = APPLICATION_RELEASE_ORDER.map((purpose) => ({
  id: `${purpose}-1`, purpose, accepted_at: "2026-09-01T00:00:00Z", revokes: null,
}));
const PART1 = { intake: { v2: true, completedAt: "2026-09-01T06:00:00Z" } } satisfies Partial<HiringChecklistInputs>;
const signed = { invitedAt: "2026-09-01T00:00:00Z", ...PART1, authorizations: ALL_PERMISSIONS } satisfies Partial<HiringChecklistInputs>;

const complete = (over: Partial<HiringChecklistInputs> = {}): HiringChecklistInputs => ({
  ...signed,
  phases: {
    applicationSentAt: "2026-09-01T12:00:00Z", reviewRequestedAt: "2026-09-02T00:00:00Z",
    approvedAt: "2026-09-03T00:00:00Z", signingOpenedAt: "2026-09-08T00:00:00Z", submittedAt: null,
  },
  qualificationKinds: ["mvr", "clearinghouse_full", "drug_test", "medical_registry_verification", "road_test", "handbook"],
  psp: { requested: true, reportReceived: true },
  packetMarks: packetDriverMarkCount(null),
  investigation: { outstanding: 0, awaiting: 0 },
  travelBooked: true,
  hiredAt: "2026-09-10",
  ...over,
});

const rowKeys = (c: ReturnType<typeof hiringChecklist>) => c.rows.map((r) => r.key);
const row = (c: ReturnType<typeof hiringChecklist>, key: string) => c.rows.find((r) => r.key === key)!;

describe("the office's rows (D-OF1, D-OF2)", () => {
  it("reads the owner's list: three pairs as one row each, previous employers and live orientation gone", () => {
    const c = hiringChecklist(complete());
    expect(rowKeys(c)).toEqual([
      "invitation_sent", "intake_completed", "mvr", "psp", "clearinghouse", "drug_test",
      "application_sent", "application_filled", "travel_booked",
      "road_test", "application_signed", "handbook", "hired",
    ]);
    expect(row(c, "intake_completed").steps.map((s) => s.key)).toEqual(["intake_completed", "permissions_signed"]);
    expect(row(c, "mvr").steps.map((s) => s.key)).toEqual(["mvr", "medical_certificate"]);
    expect(row(c, "application_filled").steps.map((s) => s.key)).toEqual(["application_filled", "office_approved"]);
  });

  it("still folds every half, so no federal gate left the hire's refusal list", () => {
    const c = hiringChecklist(complete());
    expect(c.steps.map((s) => s.key)).toEqual(expect.arrayContaining(["permissions_signed", "medical_certificate", "office_approved", "employment_investigation"]));
    expect(HIRE_REFUSES_WITHOUT).toContain("medical_certificate");
    const missing = hiringChecklist(complete({ hiredAt: null, qualificationKinds: ["mvr", "clearinghouse_full", "drug_test", "road_test"] }));
    expect(missing.readyToHire.outstanding).toEqual(["medical_certificate"]);
  });

  it("counts rows, not steps — the count the office watches is the list it sees", () => {
    const c = hiringChecklist(complete());
    expect(c.total).toBe(c.rows.length);
    expect(c.done).toBe(c.rows.length);
  });

  it("names the last row by what the office does: closing the application, the hire being McLeod's (D-OF5)", () => {
    const c = hiringChecklist(complete({ hiredAt: null }));
    expect(row(c, "hired").label).toBe("Application closed");
    expect(HIRING_STEPS.find((s) => s.key === "hired")!.action).toBe("Close the application");
  });

  it("puts the training videos after the application and before travel (D-OF4)", () => {
    const keys = HIRING_STEPS.map((s) => s.key);
    expect(keys.indexOf("orientation_videos")).toBeGreaterThan(keys.indexOf("office_approved"));
    expect(keys.indexOf("orientation_videos")).toBeLessThan(keys.indexOf("travel_booked"));
  });

  it("every shownIn names an earlier step that is itself a row", () => {
    for (const [i, s] of HIRING_STEPS.entries()) {
      if (!s.shownIn) continue;
      const host = HIRING_STEPS.findIndex((h) => h.key === s.shownIn);
      expect(host, s.key).toBeGreaterThanOrEqual(0);
      expect(host, s.key).toBeLessThan(i);
      expect(HIRING_STEPS[host]!.shownIn, `${s.key} chains`).toBeUndefined();
      expect(HIRING_STEPS[host]!.listed, `${s.key}'s host is unlisted`).toBeUndefined();
    }
  });
});

describe("a merged row's state", () => {
  it("is done only when both halves are", () => {
    const c = hiringChecklist(complete({ qualificationKinds: ["mvr", "clearinghouse_full", "drug_test", "road_test", "handbook"] }));
    expect(c.steps.find((s) => s.key === "mvr")!.state).toBe("done");
    expect(row(c, "mvr").state).toBe("waiting_on_us");
    expect(row(c, "mvr").lead.key).toBe("medical_certificate");
  });

  it("waits on the office when the office can move on either half, though the other waits on them", () => {
    // Part 1 done, permissions not signed (theirs) — the office has nothing on this row.
    const theirs = hiringChecklist({ invitedAt: "2026-09-01T00:00:00Z", ...PART1 });
    expect(row(theirs, "intake_completed").state).toBe("waiting_on_them");
    expect(row(theirs, "intake_completed").lead.key).toBe("permissions_signed");
    // Application filled (done), approval the office's.
    const ours = hiringChecklist(complete({ phases: { applicationSentAt: "2026-09-01T12:00:00Z", reviewRequestedAt: "2026-09-02T00:00:00Z", approvedAt: null, signingOpenedAt: null, submittedAt: null } }));
    expect(row(ours, "application_filled").state).toBe("waiting_on_us");
  });

  it("is blocked only when every open half is blocked", () => {
    const step = (key: HiringStep["key"], state: HiringStep["state"]) => ({ key, state }) as HiringStep;
    expect(rowState([step("mvr", "blocked"), step("medical_certificate", "waiting_on_us")])).toBe("waiting_on_us");
    expect(rowState([step("mvr", "blocked"), step("medical_certificate", "done")])).toBe("blocked");
    expect(rowState([step("mvr", "waiting_on_them"), step("medical_certificate", "blocked")])).toBe("waiting_on_them");
    // D-HUI4: the office's move is the loud one, whichever half it is on.
    expect(rowState([step("intake_completed", "waiting_on_them"), step("permissions_signed", "waiting_on_us")])).toBe("waiting_on_us");
  });

  it("draws a half whose host the fold did not emit as its own row rather than losing it", () => {
    const c = hiringChecklist(complete());
    const withoutHost = c.steps.filter((s) => s.key !== "mvr");
    const rows = hiringChecklistRows(withoutHost);
    expect(rows.map((r) => r.key)).toContain("medical_certificate");
  });
});

describe("the next action and links into a row", () => {
  it("never nominates an unlisted step (D-OF3)", () => {
    // Everything done but the investigation: before §14, "Contact the previous employers" was Next.
    const c = hiringChecklist(complete({ investigation: { outstanding: 2, awaiting: 0 } }));
    expect(c.steps.find((s) => s.key === "employment_investigation")!.state).toBe("waiting_on_us");
    expect(c.next).toBeNull();
    expect(nextStepOf(c.rows)).toBeNull();
  });

  it("opens the row that holds a half a link names (?step=medical_certificate)", () => {
    const c = hiringChecklist(complete());
    expect(rowOfStep(c.rows, "medical_certificate")!.key).toBe("mvr");
    expect(rowOfStep(c.rows, "employment_investigation")).toBeNull();
  });
});
