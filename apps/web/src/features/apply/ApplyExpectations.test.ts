import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import {
  APPLICATION_CAPTURE_SLOT_LABELS,
  APPLICATION_FILLING_SECTIONS,
  APPLICATION_SECTION_LABELS,
  APPLICATION_SECTION_MINUTES,
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
  it("says how many screens and roughly how long, before anything is asked", () => {
    const w = screen();
    expect(w.text()).toContain(`${APPLICATION_FILLING_SECTIONS.length} screens`);
    expect(w.text()).toMatch(/about \d+ minutes/);
    // Nothing is asked here, which is what lets the screen sit ahead of the 7001(c) consent: A4's
    // ruling is that nothing is asked and nothing is written before it.
    expect(w.findAll("input")).toHaveLength(0);
    expect(w.findAll("select")).toHaveLength(0);
    expect(w.findAll("textarea")).toHaveLength(0);
  });

  it("rounds the estimate, rather than dressing eight guesses up as a stopwatch", () => {
    // Exercised on the copy itself, because today's total happens to be round and a component
    // assertion would pass whether or not the rounding is there at all.
    expect(APPLY_COPY.expectations.howLong(8, 31)).toContain("about 30 minutes");
    expect(APPLY_COPY.expectations.howLong(8, 33)).toContain("about 35 minutes");
  });

  it("starts when it is told to, and does nothing else", () => {
    const w = screen();
    const button = w.findAll("button").find((b) => b.text() === APPLY_COPY.expectations.start);
    button!.trigger("click");
    expect(w.emitted("start")).toHaveLength(1);
  });
});

describe("what it says the form involves", () => {
  it("names every screen of the first visit, with the catalogue's estimate", () => {
    const w = screen();
    for (const section of APPLICATION_FILLING_SECTIONS) {
      expect(w.text()).toContain(APPLICATION_SECTION_LABELS[section]);
      expect(w.text()).toContain(`${APPLICATION_SECTION_MINUTES[section]} min`);
    }
  });

  it("leaves the certification out, because it is a second visit on another day", () => {
    // Same reason the progress list stops at "Check your answers" (F4): the office reads the
    // application before anybody signs it, so the signature is not on the clock this screen quotes.
    expect(screen().text()).not.toContain(APPLICATION_SECTION_LABELS.certify);
  });

  it("names the documents the capture screen actually asks for, and no others", () => {
    const w = screen();
    expect(w.text()).toContain(APPLICATION_CAPTURE_SLOT_LABELS.medical_card);
    expect(w.text()).toContain(APPLICATION_CAPTURE_SLOT_LABELS.cdl_front);
    // `signature_mark` and `other` are in the vocabulary and not in `APPLICATION_CAPTURE_REQUESTED`.
    // Listing them would send a driver to find a document nobody will ever ask them for — which is
    // what reading the slot list instead of the requested list would do.
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

  /**
   * ⚠ AF5 (D-AF3): the last signature is given in the carrier's office, not on a second visit to this
   * link — and a promise of "we will send you the link" would be an email that never comes.
   */
  it("says the last signature is given in the office, so finishing the form is not the end", () => {
    const afterwards = APPLY_COPY.expectations.afterwards("Silvicom Inc");
    expect(screen().text()).toContain(afterwards);
    expect(afterwards).toContain("in their office");
    expect(afterwards).not.toMatch(/second, short visit|send you the link/);
  });
});
