import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { applicationEmploymentGaps, type ApplicationEmployer } from "@silvicom/shared";
import EmploymentTimeline from "./EmploymentTimeline.vue";
import { buildTimeline, type TimelineJob } from "./timeline";
import { EMPLOYMENT_FORM_COPY } from "./employmentCopy";

/**
 * The one employment timeline (HW5b, EM-9): newest first, the 3- and 10-year lines where they fall,
 * and the gaps the filing asks about drawn between the jobs they fall between — the filing's own gaps,
 * by construction. `ASOF` 09/26/2026: the 3-year line is 09/26/2023, the 10-year line 09/26/2016.
 */
const ASOF = "2026-09-26";
const job = (key: string, startedOn: string, endedOn: string | null, over: Partial<TimelineJob> = {}): TimelineJob => ({
  key, name: key, startedOn, endedOn, operatedCmv: true, dotRegulated: true, missing: 0, unfinished: false, ...over,
});
// Recent, then a gap 07/2024–01/2025, then Middle, the 3-year line, Old, the 10-year line.
const JOBS = [
  job("Middle", "2023-01-01", "2024-07-01"),
  job("Recent", "2025-01-01", null),
  job("Old", "2017-01-01", "2020-01-01"),
];

const order = (jobs: TimelineJob[], withGaps = true) =>
  buildTimeline(jobs, ASOF, withGaps).entries.map((e) =>
    e.kind === "job" ? e.job.key : e.kind === "gap" ? `gap ${e.gap.from}→${e.gap.to}` : `${e.years}y ${e.date}`);

describe("the order", () => {
  it("is newest first, with the gap between the jobs it falls between and each line where it falls", () => {
    expect(order(JOBS)).toEqual([
      "Recent",
      "gap 2024-07-01→2025-01-01",
      "Middle",
      "3y 2023-09-26",
      "Old",
      "10y 2016-09-26",
    ]);
  });

  it("puts a job with no dates yet at the top, where whoever must finish it sees it", () => {
    expect(order([...JOBS, job("Undated", "", null, { unfinished: true })], false)[0]).toBe("Undated");
  });

  it("draws the gaps the filing asks about — `applicationEmploymentGaps`, the same function", () => {
    const filed = JOBS.map((j) => ({
      employer_name: j.name, started_on: j.startedOn, ended_on: j.endedOn, operated_cmv: true, dot_regulated: true,
    })) as ApplicationEmployer[];
    expect(buildTimeline(JOBS, ASOF, true).gaps).toEqual(applicationEmploymentGaps(filed, ASOF));
  });

  it("counts the driving jobs between the two lines — the 10-year coverage nobody was shown", () => {
    // Old, and Middle — which straddles the 3-year line and so belongs to both windows.
    expect(buildTimeline(JOBS, ASOF, true).cmvBetween).toBe(2);
    expect(buildTimeline([...JOBS.slice(0, 2), { ...JOBS[2]!, operatedCmv: false }], ASOF, true).cmvBetween).toBe(1);
  });
});

const timeline = (props: Record<string, unknown> = {}) =>
  mount(EmploymentTimeline, { props: { jobs: JOBS, asOf: ASOF, copy: EMPLOYMENT_FORM_COPY, ...props } });

describe("what it shows", () => {
  it("each job with its dates as MM/DD/YYYY, its tags, and whether it is complete", () => {
    const w = timeline({ jobs: [job("Middle", "2023-01-01", "2024-07-01", { missing: 2, operatedCmv: false }), job("Recent", "2025-01-01", null)] });
    const middle = w.get('[data-job="Middle"]').text();
    expect(middle).toContain("01/01/2023 – 07/01/2024");
    expect(middle).toContain("2 details missing");
    expect(middle).not.toContain(EMPLOYMENT_FORM_COPY.tagTruck);
    const recent = w.get('[data-job="Recent"]').text();
    expect(recent).toContain("01/01/2025 – now");
    expect(recent).toContain(EMPLOYMENT_FORM_COPY.tagTruck);
    expect(recent).toContain(EMPLOYMENT_FORM_COPY.tagDot);
    expect(recent).toContain(EMPLOYMENT_FORM_COPY.jobComplete);
  });

  it("names an unfinished job so and offers to finish it", () => {
    const w = timeline({ jobs: [job("", "2023-01-01", null, { unfinished: true })] });
    expect(w.text()).toContain(EMPLOYMENT_FORM_COPY.unfinished);
    expect(w.text()).toContain(EMPLOYMENT_FORM_COPY.noName);
    expect(w.findAll("button").map((b) => b.text())).toContain(EMPLOYMENT_FORM_COPY.finish);
  });

  it("draws both lines with their dates", () => {
    const w = timeline();
    expect(w.get('[data-mark="3"]').text()).toContain("3 years ago · 09/26/2023");
    expect(w.get('[data-mark="10"]').text()).toContain("10 years ago · 09/26/2016");
    expect(w.get('[data-mark="10"]').text()).toContain("2 driving jobs between the two lines.");
  });

  it("shows a gap's explanation when one was given, and the surface's own box in its place when it brings one", () => {
    expect(timeline({ explanations: { "2024-07-01": "School" } }).get('[data-gap="2024-07-01"]').text()).toContain("School");
    const w = mount(EmploymentTimeline, {
      props: { jobs: JOBS, asOf: ASOF, copy: EMPLOYMENT_FORM_COPY },
      slots: { gap: "<textarea data-box />" },
    });
    expect(w.get('[data-gap="2024-07-01"]').find("[data-box]").exists()).toBe(true);
  });

  it("hides the gaps when told to — the applicant's screen before any job is listed", () => {
    expect(timeline({ showGaps: false }).find("[data-gap]").exists()).toBe(false);
  });
});

describe("what it asks for", () => {
  it("edits a job by its key, never its position", async () => {
    const w = timeline();
    await w.get('[data-job="Middle"] button').trigger("click");
    expect(w.emitted("edit")).toEqual([["Middle"]]);
  });

  it("adds a job into a gap with the gap's dates", async () => {
    const w = timeline();
    await w.get('[data-gap="2024-07-01"]').findAll("button").find((b) => b.text() === EMPLOYMENT_FORM_COPY.addJobHere)!.trigger("click");
    expect(w.emitted("add")).toEqual([[{ started_on: "2024-07-01", ended_on: "2025-01-01" }]]);
  });

  it("offers nothing to press when it is read-only", () => {
    expect(timeline({ editable: false }).findAll("button")).toHaveLength(0);
  });
});
