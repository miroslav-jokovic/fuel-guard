import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { hiringChecklist, type HiringChecklistInputs } from "@silvicom/shared";
import { APPLICATION_RELEASE_ORDER } from "@silvicom/shared";
import { packetDriverMarkCount } from "@silvicom/shared";
import HiringChecklistCard from "@/features/recruitment/HiringChecklistCard.vue";

/**
 * The office's checklist (B5, `HIRING-UI-PLAN.md` §5).
 *
 * ── THE FIXTURE IS THE REAL FOLD, NOT A HAND-WRITTEN CHECKLIST OBJECT ─────────────────────────
 * ⚠ Every case below calls `hiringChecklist()` with evidence rows and renders whatever comes back.
 * A hand-built `{ steps: [...] }` literal would let this file keep passing while the fold and the
 * component disagreed about what a row means — which is the whole failure D-HM2 exists to prevent,
 * asserted on the wrong side of the seam. It also means the fixtures are built from
 * `APPLICATION_RELEASE_ORDER` and `packetDriverMarkCount()` rather than from `4` and `22`, so they
 * cannot pass through the change they exist to catch.
 */

const routes = [
  { path: "/recruitment/:id", name: "applicant-record", component: { template: "<div />" } },
  { path: "/drivers/:id", name: "driver-detail", component: { template: "<div />" } },
];

const DRIVER = "driver-1";

async function mountWith(input: HiringChecklistInputs) {
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push(`/recruitment/${DRIVER}`);
  await router.isReady();
  return mount(HiringChecklistCard, {
    props: { driverId: DRIVER, checklist: hiringChecklist(input), loading: false, error: null },
    global: { plugins: [router] },
  });
}

/** Just invited: the link is out, the applicant has signed nothing. */
const JUST_INVITED: HiringChecklistInputs = { invitedAt: "2026-09-01T00:00:00Z" };

/** Everything this schema can see is done. */
const COMPLETE: HiringChecklistInputs = {
  invitedAt: "2026-09-01T00:00:00Z",
  phases: {
    applicationSentAt: "2026-09-01T12:00:00Z",
    reviewRequestedAt: "2026-09-02T00:00:00Z",
    approvedAt: "2026-09-03T00:00:00Z",
    signingOpenedAt: "2026-09-08T00:00:00Z",
    submittedAt: null,
  },
  authorizations: APPLICATION_RELEASE_ORDER.map((purpose) => ({
    id: `${purpose}-1`,
    purpose,
    accepted_at: "2026-09-01T00:00:00Z",
    revokes: null,
  })),
  qualificationKinds: [
    "mvr", "clearinghouse_full", "drug_test", "medical_registry_verification", "road_test",
  ],
  psp: { requested: true, reportReceived: true },
  packetMarks: packetDriverMarkCount(),
  hiredAt: "2026-09-10",
};

describe("a row answers D-HUI3's three questions", () => {
  /**
   * ⚠ The defect B5 exists to fix. `spec.evidence` is `"qualification_records.mvr"` and it was what
   * the artifact column rendered — a database identifier on a recruiter's screen. The fix is in the
   * catalogue rather than in a map here, so this asserts the OUTCOME: no row on this card may show
   * a table name, whatever the fold hands over.
   */
  it("never puts a database table name on the screen", async () => {
    const wrapper = await mountWith(COMPLETE);
    const text = wrapper.text();
    expect(text).not.toContain("qualification_records");
    expect(text).not.toContain("application_packet_marks");
    expect(text).not.toContain("driver_authorizations");
    expect(text).not.toContain("hire_date");
  });

  it("states the step, the state and the artifact, and links the artifact where there is one", async () => {
    const wrapper = await mountWith(COMPLETE);
    const text = wrapper.text();
    expect(text).toContain("Driving record");
    expect(text).toContain("Done");
    expect(text).toContain("MVR report");

    // The §391.51 file is where that report is filed, so that is where the row goes.
    const link = wrapper
      .findAll("a")
      .find((a) => a.text().includes("MVR report"));
    expect(link?.attributes("href")).toBe(`/drivers/${DRIVER}?section=qualification`);
  });

  /**
   * ⚠ Words with no link, never a link to somewhere nearby. Nothing in the office's half of the
   * product shows a signed authorization (Q-HUI6), and a row that says "Authorizations" and opens
   * the wrong document is worse than one that does not open.
   */
  it("states an artifact it cannot reach, without inventing a destination for it", async () => {
    const wrapper = await mountWith(COMPLETE);
    expect(wrapper.text()).toContain("Authorizations");
    expect(wrapper.findAll("a").some((a) => a.text().includes("Authorizations"))).toBe(false);
  });

  /** ⚠ The artifact is null until the step is done — showing it early names a proof that is not there. */
  it("shows no artifact before the step is done", async () => {
    const wrapper = await mountWith(JUST_INVITED);
    expect(wrapper.text()).not.toContain("MVR report");
  });

  /**
   * ⚠ A blocked row NAMES its blocker in words — NN/g's *label and highlight*, and the difference
   * between a checklist and a wall. A greyed row with no explanation is the failure.
   */
  it("says what a blocked row is blocked by", async () => {
    const wrapper = await mountWith(JUST_INVITED);
    expect(wrapper.text()).toContain("Needs: Permissions signed");
  });
});

describe("state is never colour alone (D-HUI4)", () => {
  /**
   * ⚠ Every state badge carries a glyph as well as its word. `AppIcon` renders an `<svg>`, so the
   * count of badges and the count of glyphs inside them must match — a badge that lost its icon
   * would still read correctly here and fail this.
   */
  it("gives every step badge an icon and a word", async () => {
    const wrapper = await mountWith(JUST_INVITED);
    const rows = wrapper.findAll("li");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const badge = row.find("span.inline-flex");
      expect(badge.exists()).toBe(true);
      expect(badge.find("svg").exists()).toBe(true);
      expect(badge.text().length).toBeGreaterThan(0);
    }
  });

  /**
   * ⚠ *"A board where everything shouts is a board nobody reads."* Only `waiting_on_us` is toned at
   * all, and the number of rows in that state is bounded by the catalogue's `requires` rather than
   * by taste: a freshly invited applicant has exactly ONE, the Clearinghouse query, which is the
   * only measurable step with no prerequisite.
   */
  it("shouts on exactly the rows that are the office's own move", async () => {
    const wrapper = await mountWith(JUST_INVITED);
    const loud = wrapper.findAll("li").filter((row) => row.html().includes("bg-warning-50"));
    expect(loud).toHaveLength(1);
    expect(loud[0]!.text()).toContain("Clearinghouse query");
  });
});

describe("the row is where the work starts (B6)", () => {
  /**
   * ⚠ The card emits and does not open. Q-HUI3 names the DQF page as the second consumer that
   * promotes this component out of `features/` under D-DS18, and a drawer wired in here would bake a
   * recruitment-shaped assumption into it before that move — so the contract asserted is the EVENT.
   */
  it("emits the step a reader chose, not its key or its index", async () => {
    const wrapper = await mountWith(JUST_INVITED);
    const rows = wrapper.findAll("li");
    await rows[4]!.find("button").trigger("click");
    const emitted = wrapper.emitted("open");
    expect(emitted).toHaveLength(1);
    expect((emitted![0]![0] as { key: string }).key).toBe(
      hiringChecklist(JUST_INVITED).steps[4]!.key,
    );
  });

  /**
   * ⚠ The lead action and the row must land in the SAME place. Before B6 the card said what to do
   * next and left the reader to find where, which is the gap between a checklist and a board — and
   * a second destination for one instruction would be worse than the sentence it replaced.
   */
  it("leads with a button that opens the same step the next action names", async () => {
    const wrapper = await mountWith(JUST_INVITED);
    const c = hiringChecklist(JUST_INVITED);
    const lead = wrapper.findAll("button").find((b) => b.text().includes("Sign the permissions"));
    expect(lead, "the next action is not a button").toBeTruthy();
    await lead!.trigger("click");
    expect((wrapper.emitted("open")![0]![0] as { key: string }).key).toBe(c.next);
  });

  /**
   * ⚠ The artifact link stays OUTSIDE the row button. A link nested inside a button is invalid
   * markup and a target a keyboard cannot reach separately — two destinations in one row have to be
   * two siblings, and this is the assertion that keeps them apart.
   */
  it("keeps the artifact link out of the row button", async () => {
    const wrapper = await mountWith(COMPLETE);
    for (const button of wrapper.findAll("li button")) {
      expect(button.find("a").exists(), "an artifact link is nested inside a row button").toBe(false);
    }
    expect(wrapper.findAll("li a").length).toBeGreaterThan(0);
  });
});

describe("the header and the summary", () => {
  /**
   * ⚠ Progress is a percentage of STEPS and the count never renumbers under somebody — completed
   * steps stay counted rather than being filtered out (`usePacketCeremony`'s ruling).
   */
  it("counts steps, keeps the completed ones, and says the count in words", async () => {
    const wrapper = await mountWith(COMPLETE);
    const c = hiringChecklist(COMPLETE);
    expect(wrapper.text()).toContain(`${c.done} of ${c.total} done`);
    expect(wrapper.find('[role="status"]').text()).toBe(`${c.done} of ${c.total} hiring steps done.`);
    expect(wrapper.findAll("li")).toHaveLength(c.total);
  });

  /** ⚠ The bar is `aria-hidden` and the heading carries the number — `ApplyProgress`'s ruling. */
  it("hides the bar from the reader who is being told the number in words", async () => {
    const wrapper = await mountWith(COMPLETE);
    const bar = wrapper.find('[aria-hidden="true"].shrink-0');
    expect(bar.exists()).toBe(true);
    expect(bar.text()).toContain("%");
  });

  /**
   * The one action to lead with is an INSTRUCTION, never the step's label as a completed fact.
   *
   * ⚠ B4 shipped that defect on the board's own Next-action column — *"Next action: Office approved
   * it"* — and it was found by looking at the screen, not by a test. `action` is the field that
   * fixed it and this is the assertion that keeps it fixed here. The step is `permissions_signed`
   * rather than the office's own next move: `next` is the first step in D-HM9's order that is
   * neither done nor blocked, which is what stops the card recommending a Clearinghouse query the
   * carrier pays for on somebody who has signed nothing.
   */
  it("leads with the next action as something to do", async () => {
    const wrapper = await mountWith(JUST_INVITED);
    expect(wrapper.text()).toContain("Next: Sign the permissions");
    expect(wrapper.text()).not.toContain("Next: Permissions signed");
  });

  /**
   * ⚠ The most important assertion in this file. `readyToTravel.ok` is false for EVERYBODY until D4
   * ships, because step 9 has no evidence table — and a card that answered "ready" would be
   * reporting a gate nobody has checked. So the unmeasured step is named on screen, not swallowed.
   */
  it("refuses to call an applicant ready to travel while a step cannot be checked at all", async () => {
    const wrapper = await mountWith(COMPLETE);
    const c = hiringChecklist(COMPLETE);
    expect(c.readyToTravel.ok).toBe(false);
    expect(c.readyToTravel.outstanding).toHaveLength(0);
    expect(wrapper.text()).toContain("Not ready to travel");
    expect(wrapper.text()).toContain("orientation videos cannot be checked yet");
  });
});
