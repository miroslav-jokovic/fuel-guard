import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { employmentProgress, monthName } from "./employmentProgress";
import { emptyDraft, emptyEmployer, type ApplicationDraft, type DraftEmployer } from "./draft";
import ApplyEmploymentFields from "./ApplyEmploymentFields.vue";

/**
 * §391.21(b)(10)–(11), one job at a time (X5, D-AX2).
 *
 * The screen this replaces held fifteen controls per employer plus five per equipment row — 107 for
 * an ordinary six-employer ten-year history, on a form nine in ten of whose applicants are holding a
 * phone. What is pinned here is the shape of the replacement and the two things about it that would
 * be expensive to get wrong: a cancelled job must leave nothing behind, and the coverage the driver
 * is shown must be the SHARED calculator's, including its refusal to call a hole in years four to
 * ten a defect.
 */

const ASOF = "2026-09-11";

const job = (over: Partial<DraftEmployer> = {}): DraftEmployer => ({
  ...emptyEmployer(),
  employer_name: "Old Carrier",
  started_on: "2024-01-01",
  ended_on: "2026-09-01",
  ...over,
});

describe("how much of the window the driver has accounted for", () => {
  it("says nothing is covered when nothing is entered", () => {
    const p = employmentProgress([], ASOF);
    expect(p.empty).toBe(true);
    expect(p.percent).toBe(0);
    expect(p.gaps).toEqual([]);
  });

  it("ignores a row with no name or no start date, because a half-typed row is not a claim", () => {
    expect(employmentProgress([emptyEmployer()], ASOF).empty).toBe(true);
    expect(employmentProgress([job({ started_on: "" })], ASOF).empty).toBe(true);
    expect(employmentProgress([job({ employer_name: "  " })], ASOF).empty).toBe(true);
  });

  it("reads an empty end date as still employed, not as a zero-day job", () => {
    const p = employmentProgress([job({ started_on: "2020-01-01", ended_on: "" })], ASOF);
    expect(p.percent).toBe(100);
    expect(p.gaps).toEqual([]);
  });

  it("finds a hole in the last three years and says when it was", () => {
    const p = employmentProgress(
      [
        job({ employer_name: "A", started_on: "2023-09-01", ended_on: "2024-06-01" }),
        job({ employer_name: "B", started_on: "2025-02-01", ended_on: "" }),
      ],
      ASOF,
    );
    expect(p.gaps).toHaveLength(1);
    expect(p.gaps[0]!.from).toBe("June 2024");
    expect(p.gaps[0]!.to).toBe("February 2025");
  });

  /**
   * ⚠ The assertion that is really about `employmentCoverage`, and the reason this module converts
   * rather than calculates. §391.21(b)(11) asks only for COMMERCIAL driving in years four to ten, so
   * an applicant who spent year five in a warehouse owes no explanation — reporting a gap there would
   * be wrong in the direction that costs somebody a job.
   */
  it("never calls a hole in years four to ten a gap", () => {
    const p = employmentProgress(
      [job({ employer_name: "Recent", started_on: "2023-09-01", ended_on: "" })],
      ASOF,
    );
    expect(p.percent).toBe(100);
    expect(p.gaps).toEqual([]);
  });

  it("counts which window each job answers", () => {
    const p = employmentProgress(
      [
        job({ employer_name: "Recent", started_on: "2024-01-01", ended_on: "" }),
        job({ employer_name: "Old CMV", started_on: "2018-01-01", ended_on: "2020-01-01", operated_cmv: true }),
      ],
      ASOF,
    );
    expect(p.b10).toBe(1);
    expect(p.b11).toBe(1);
  });

  it("never reads over 100%, however the jobs overlap", () => {
    const p = employmentProgress(
      [
        job({ employer_name: "A", started_on: "2020-01-01", ended_on: "" }),
        job({ employer_name: "B", started_on: "2020-01-01", ended_on: "" }),
      ],
      ASOF,
    );
    // A meter reading 190% is a meter nobody trusts again.
    expect(p.percent).toBe(100);
  });

  it("names a month the same way in any timezone", () => {
    expect(monthName("2024-06-01")).toBe("June 2024");
    expect(monthName("2024-01-31")).toBe("January 2024");
    expect(monthName("nonsense")).toBe("nonsense");
  });
});

/** Renders both slots inline, footer included — the drawer's Save button lives in `#footer`. */
const SlideOverStub = {
  template: "<div v-if='open'><slot /><slot name='footer' /></div>",
  props: ["open", "title", "size", "description"],
};

const screen = (draft: ApplicationDraft) =>
  mount(ApplyEmploymentFields, {
    props: { modelValue: draft, "onUpdate:modelValue": (v: ApplicationDraft) => Object.assign(draft, v) },
    global: { stubs: { SlideOver: SlideOverStub } },
  });

const button = (w: ReturnType<typeof screen>, label: string) =>
  w.findAll("button").find((b) => b.text().trim() === label);

describe("the hub, and one job at a time", () => {
  it("offers a first job rather than another one", () => {
    const d = emptyDraft();
    d.employers = [];
    expect(button(screen(d), "Add your first job")).toBeTruthy();
  });

  it("opens a panel for a new job, and commits it on save", async () => {
    const d = emptyDraft();
    d.employers = [];
    const w = screen(d);
    await button(w, "Add your first job")!.trigger("click");

    await w.find("#apply-employers-0-employer_name").setValue("Old Carrier");
    await w.find("#apply-employers-0-position_held").setValue("Driver");
    await w.find("#apply-employers-0-started_on").setValue("01/02/2024");
    await w.find("#apply-employers-0-started_on").trigger("keydown.enter");
    await w.vm.$nextTick();
    await button(w, "Save this job")!.trigger("click");

    expect(d.employers).toHaveLength(1);
    expect(d.employers[0]!.employer_name).toBe("Old Carrier");
    expect(d.employers[0]!.position_held).toBe("Driver");
  });

  it("refuses to save a job with no name, and says so next to the box", async () => {
    const d = emptyDraft();
    d.employers = [];
    const w = screen(d);
    await button(w, "Add your first job")!.trigger("click");
    await button(w, "Save this job")!.trigger("click");

    expect(w.text()).toContain("This is needed.");
    expect(w.find("#apply-employers-0-employer_name").attributes("aria-invalid")).toBe("true");
    // Still open, and nothing committed.
    expect(d.employers[0]!.employer_name).toBe("");
  });

  /**
   * ⚠ The one that would have been found in production. A row added and abandoned stays in the draft
   * as a blank, `toApplication` drops unnamed rows silently, and the review screen's count then
   * disagrees with the list the driver was looking at.
   */
  it("leaves nothing behind when a new job is cancelled", async () => {
    const d = emptyDraft();
    d.employers = [];
    const w = screen(d);
    await button(w, "Add your first job")!.trigger("click");
    expect(d.employers).toHaveLength(1);

    await button(w, "Cancel")!.trigger("click");
    expect(d.employers).toHaveLength(0);
  });

  it("discards an edit that was cancelled, rather than autosaving every keystroke of it", async () => {
    const d = emptyDraft();
    d.employers = [job()];
    const w = screen(d);
    await button(w, "Change")!.trigger("click");
    await w.find("#apply-employers-0-employer_name").setValue("Typed by mistake");
    await button(w, "Cancel")!.trigger("click");

    expect(d.employers[0]!.employer_name).toBe("Old Carrier");
    expect(d.employers).toHaveLength(1);
  });

  it("lists each job by name, not a count of them", async () => {
    const d = emptyDraft();
    d.employers = [job({ employer_name: "Old Carrier" }), job({ employer_name: "Second Carrier" })];
    const w = screen(d);
    expect(w.text()).toContain("Old Carrier");
    expect(w.text()).toContain("Second Carrier");
    expect(w.text()).not.toMatch(/\b2 employers\b/);
  });

  /**
   * ⚠ Owner, 2026-09-11: *"most of the drivers are not remembering all places and exact company
   * names, so this should be much simpler with company name, and dates from to he worked there, all
   * other things are optional."*
   *
   * `applicationEmployerSchema` has only ever required `employer_name` and `started_on` — the panel
   * simply LOOKED mandatory, fifteen controls deep. What is pinned is that the three the regulation
   * needs are the three in front of the driver, and that nothing was dropped to get there.
   */
  it("asks for three things, and puts the rest behind a disclosure", async () => {
    const d = emptyDraft();
    d.employers = [];
    const w = screen(d);
    await button(w, "Add your first job")!.trigger("click");

    /**
     * ⚠ Asked POSITIONALLY — "is this input a descendant of the disclosure" — and not by comparing
     * id lists. The first version of this assertion gathered the ids inside `<details>` and
     * subtracted them from all the ids on the panel, which looks equivalent and is not: a field
     * rendered in BOTH places has its id in the subtracted set, so the copy sitting above the fold
     * vanished from the comparison. A mutation that put `position_held` back on top passed it.
     */
    const details = w.find("details").element;
    const primary = w
      .findAll("input")
      .filter((i) => !details.contains(i.element))
      .map((i) => i.attributes("id"))
      .filter((id) => id?.startsWith("apply-employers"));

    expect(primary).toEqual([
      "apply-employers-0-employer_name",
      "apply-employers-0-started_on",
      "apply-employers-0-ended_on",
    ]);
  });

  it("keeps every optional answer reachable, rather than deleting the question", async () => {
    // Simpler is not the same as smaller: a driver who DOES remember the dispatcher's number must
    // still have somewhere to put it, and §391.23 still wants an address to write to.
    const d = emptyDraft();
    d.employers = [];
    const w = screen(d);
    await button(w, "Add your first job")!.trigger("click");

    for (const field of ["position_held", "usdot_number", "address_line1", "city", "state", "phone", "email", "reason_for_leaving"]) {
      expect(w.find(`#apply-employers-0-${field}`).exists()).toBe(true);
    }
    expect(w.findAll("details")).toHaveLength(1);
  });

  it("removes a job from inside the panel, not from a button beside Change", async () => {
    // Measured at 390px: the two sat a thumb's width apart, and they are not equally undoable.
    const d = emptyDraft();
    d.employers = [job({ employer_name: "Old Carrier" })];
    const w = screen(d);
    expect(button(w, "Remove")).toBeUndefined();

    await button(w, "Change")!.trigger("click");
    await button(w, "Remove")!.trigger("click");
    expect(d.employers).toHaveLength(0);
  });

  it("offers no Remove for a job that has never been saved", async () => {
    // There is nothing to remove — Cancel already discards it, and two ways out of an empty panel
    // is one more decision than the moment needs.
    const d = emptyDraft();
    d.employers = [];
    const w = screen(d);
    await button(w, "Add your first job")!.trigger("click");
    expect(button(w, "Remove")).toBeUndefined();
  });

  it("hides the list entirely when the driver declares no employment", async () => {
    const d = emptyDraft();
    d.employers = [];
    d.declares_no_employment = true;
    const w = screen(d);
    expect(button(w, "Add your first job")).toBeUndefined();
    expect(w.text()).not.toContain("How much you have accounted for");
  });
});
