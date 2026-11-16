import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import {
  APPLICATION_CAPTURE_SLOT_LABELS,
  APPLICATION_FILLING_MINUTES,
  APPLICATION_STAGES,
  APPLICATION_STAGE_MINUTES,
} from "@silvicom/shared";
import ApplyExpectations from "./ApplyExpectations.vue";
import { APPLY_COPY } from "./strings";

/**
 * What the applicant is told before any of it is asked (B7).
 *
 * What is worth pinning is not that a card renders. It is that this screen states no fact about the
 * form of its own: the screens, their estimates and the documents are all read from the catalogues
 * the rest of the flow renders, so it cannot promise a screen that is not there, a photograph nobody
 * is asked for, or a length that has drifted from the one the wizard shows.
 */
const screen = (props: Partial<{ carrier: string; signFirst: boolean }> = {}) =>
  mount(ApplyExpectations, { props: { carrier: "Silvicom Inc", signFirst: false, ...props } });

describe("the decision it is asking for", () => {
  it("says it is three stages, each on a new link, before anything is asked", () => {
    const w = screen();
    expect(w.text()).toContain(APPLY_COPY.expectations.howLong);
    // The server rotates the link at each stage (applicationSend.ts, applicationSendForSigning.ts), so
    // a promise of one link sends the driver back to a dead one.
    expect(w.text()).toContain("a new link for each one");
    expect(w.text()).not.toMatch(/same link/i);
    // Nothing is asked here, which is what lets the screen sit ahead of the 7001(c) consent: A4's
    // ruling is that nothing is asked and nothing is written before it.
    expect(w.findAll("input")).toHaveLength(0);
    expect(w.findAll("select")).toHaveLength(0);
    expect(w.findAll("textarea")).toHaveLength(0);
  });

  it("rounds an estimate, rather than dressing a guess up as a stopwatch", () => {
    expect(APPLY_COPY.expectations.minutes(31)).toBe("about 30 minutes");
    expect(APPLY_COPY.expectations.minutes(33)).toBe("about 35 minutes");
    expect(APPLY_COPY.expectations.minutes(2)).toBe("about 5 minutes");
  });

  it("starts when it is told to, and does nothing else", () => {
    const w = screen();
    const button = w.findAll("button").find((b) => b.text() === APPLY_COPY.expectations.start);
    button!.trigger("click");
    expect(w.emitted("start")).toHaveLength(1);
  });
});

describe("what it says the application involves", () => {
  it("names the three stages in order, each with shared's estimate and what it waits for", () => {
    const rows = screen().findAll("[data-stages] li");
    expect(rows).toHaveLength(APPLICATION_STAGES.length);
    APPLICATION_STAGES.forEach((stage, i) => {
      expect(rows[i]!.text()).toContain(`${i + 1}. ${APPLY_COPY.stages.names[stage]}`);
      expect(rows[i]!.text()).toContain(APPLY_COPY.expectations.minutes(APPLICATION_STAGE_MINUTES[stage]));
      expect(rows[i]!.text()).toContain(APPLY_COPY.expectations.stage[stage].what);
    });
    // The middle visit's own estimate is the task list's sum, not a second number.
    expect(APPLICATION_STAGE_MINUTES.history).toBe(APPLICATION_FILLING_MINUTES);
  });

  it("says the signing is on the driver's own phone, from a link the office sends (D-AW14)", () => {
    const signing = APPLY_COPY.expectations.stage.signing.when("Silvicom Inc");
    expect(screen().text()).toContain(signing);
    expect(signing).toContain("signing link to your phone");
    // The link is sent at the visit, never with the approval (applicationApprovalNotice.ts).
    expect(signing).toContain("When you come in");
    expect(screen().text()).not.toMatch(/in their office|road test/);
  });

  it("names the documents the capture screen actually asks for, and no others", () => {
    const w = screen();
    expect(w.text()).toContain(APPLICATION_CAPTURE_SLOT_LABELS.medical_card);
    expect(w.text()).toContain(APPLICATION_CAPTURE_SLOT_LABELS.cdl_front);
    // `signature_mark` and `other` are in the vocabulary and not in `APPLICATION_CAPTURE_REQUESTED`.
    expect(w.text()).not.toContain(APPLICATION_CAPTURE_SLOT_LABELS.signature_mark);
    expect(w.text()).not.toContain(APPLICATION_CAPTURE_SLOT_LABELS.other);
  });
});

describe("the parts of the process nobody expects", () => {
  it("warns that the permissions are signed first, when they will be", () => {
    expect(screen({ signFirst: true }).text()).toContain(
      APPLY_COPY.expectations.signFirst("Silvicom Inc"),
    );
  });

  it("says nothing about them while the wording is draft and the ceremony is skipped", () => {
    // The partial case, and the one that matters: a screen promising a step the page then skips is
    // worse than a screen that says nothing, because the driver spends the whole form waiting for it.
    expect(screen({ signFirst: false }).text()).not.toContain(
      APPLY_COPY.expectations.signFirst("Silvicom Inc"),
    );
  });
});
