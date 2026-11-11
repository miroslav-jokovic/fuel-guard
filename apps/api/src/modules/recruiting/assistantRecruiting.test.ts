import { beforeEach, describe, expect, it, vi } from "vitest";
import { applicantsToQuery } from "@silvicom/shared";

/** The tool's answer is `unknown` to its caller (it goes to the model as JSON); tests read named fields. */
type Out = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Ask AI's `recruiting_counts` (F21 R6b). Its header promises the board's own rows, counted by the
 * fields the board's options count, in the board's default order, with statuses only. So
 * `readApplicantPipeline` is a spy whose rows carry what must NOT leave (a decision's reason, gap days,
 * whether a date of birth is recorded) beside what may.
 */
const readApplicantPipeline = vi.fn();
vi.mock("./routes/employmentPipeline.js", () => ({ readApplicantPipeline: (...a: unknown[]) => readApplicantPipeline(...a) }));
const { assistantRecruiting, RECRUITING_SOURCE } = await import("./assistantRecruiting.js");

const ORG = "org-1";
const row = (name: string, checklist: Record<string, unknown> | null, disposition: Record<string, unknown> | null = null) => ({
  driver_id: name, full_name: name, applied_on: "2026-11-01", date_of_birth_recorded: true, employers: 2, employers_in_window: 2,
  cmv_employers: 1, gap_days: 47, stage: "application", outstanding: [], releases_complete: false, disposition, checklist, last_note: null,
});
const cl = (phase: string | null, waiting_on: string | null, days: number, ready = false) =>
  ({ next: "x", next_label: `Next for ${phase}`, phase, waiting_on, done: 3, total: 16, days_waiting: days, last_progress_at: null, ready_to_screen: ready });

const BOARD = [
  row("ANA", cl("application", "them", 2)),
  row("BEN", cl("screening", "us", 9, true)),
  row("CAL", cl("screening", "us", 4)),
  row("DEE", cl("orientation", "them", 14), { outcome: "declined", reason: "MVR: two serious violations", rested_on_consumer_report: true }),
  row("EVE", null),
];

beforeEach(() => {
  readApplicantPipeline.mockReset();
  readApplicantPipeline.mockResolvedValue({ ok: true, applicants: BOARD });
});

describe("recruiting_counts — the Applicants board's queues", () => {
  it("reads the board for this org, the default (unarchived) view, and counts the board's own fields", async () => {
    const admin = {} as never;
    const out = (await assistantRecruiting(admin, ORG, {})) as Out;
    expect(readApplicantPipeline).toHaveBeenCalledWith(admin, ORG);
    expect(out).toMatchObject({
      source: RECRUITING_SOURCE,
      applicants_on_the_board: 5,
      waiting_on_us: 2,
      waiting_on_them: 2,
      ready_to_screen: 1,
      by_stage: { Application: 1, Screening: 2, Orientation: 1, "Nothing outstanding": 1 },
      decided: { declined: 1 },
    });
  });

  it("lists longest waiting first, as the board opens, with statuses only", async () => {
    const out = (await assistantRecruiting({} as never, ORG, {})) as Out;
    expect(out.applicants.map((a: Out) => a.applicant)).toEqual(["DEE", "BEN", "CAL", "ANA", "EVE"]);
    expect(out.applicants[0]).toEqual({
      applicant: "DEE", applied_on: "2026-11-01", stage: "Orientation", waiting_on: "them",
      next_step: "Next for orientation", days_waiting: 14, steps_done: "3 of 16", decision: "declined",
    });
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/MVR|serious|gap|date_of_birth|consumer_report/);
  });

  it("waiting_on and phase narrow the list as the board's filters do", async () => {
    const us = (await assistantRecruiting({} as never, ORG, { waiting_on: "us" })) as Out;
    expect(us.applicants.map((a: Out) => a.applicant)).toEqual(["BEN", "CAL"]);
    const screening = (await assistantRecruiting({} as never, ORG, { phase: "screening", waiting_on: "them" })) as Out;
    expect(screening.applicants).toEqual([]);
  });

  it("a failed read is an error, never an empty board", async () => {
    readApplicantPipeline.mockResolvedValue({ ok: false, message: "Could not load the pipeline" });
    await expect(assistantRecruiting({} as never, ORG, {})).rejects.toThrow("Could not load the pipeline");
  });

  // F21 R4b. The board opens on "waiting on you": a link for everybody must SAY everybody (`any`), or the
  // reader lands on a shorter list than the answer counted.
  it("links to the board on the answer's queue and stage, writing everybody as `any`", async () => {
    const all = (await assistantRecruiting({} as never, ORG, {})) as Out;
    expect(all.link).toEqual({ surfaceKey: "recruitment.applicants", query: { waiting: "any" } });
    const them = (await assistantRecruiting({} as never, ORG, { waiting_on: "them", phase: "screening" })) as Out;
    expect(them.link.query).toEqual(applicantsToQuery({ waiting: "them", phase: "screening" }));
    expect(them.link.query).toEqual({ waiting: "them", phase: "screening" });
  });
});
