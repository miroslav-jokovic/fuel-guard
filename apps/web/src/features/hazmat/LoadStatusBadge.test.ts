import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { HAZMAT_LOAD_STATUS_LABELS } from "@silvicom/shared";
import LoadStatusBadge from "./LoadStatusBadge.vue";
import { tierLabel } from "./reviewModel";

/**
 * ⚠ This exists to stop `capitalize` coming back.
 *
 * `badges.ts` removed `capitalize` from `BADGE_BASE` on 2026-08-20 because the transform title-cased
 * the label maps' sentence-case strings — "No response" became "No Response" — and said that a
 * call-site `capitalize` marks "a vocabulary that has not been mapped yet". Four hazmat badges added
 * it straight back over MAPPED vocabularies, so the loads board shipped "Needs Review".
 *
 * Nothing else catches this. It type-checks, it passes the token gate, and it looks deliberate.
 */
describe("hazmat badges keep the copy voice", () => {
  it("renders the status label exactly as the map states it", () => {
    const w = mount(LoadStatusBadge, { props: { status: "needs_review" } });
    expect(w.text()).toBe("Needs review");
    expect(w.text()).not.toBe("Needs Review");
  });

  it("never applies a case transform to a mapped label", () => {
    for (const status of Object.keys(HAZMAT_LOAD_STATUS_LABELS)) {
      const cls = mount(LoadStatusBadge, { props: { status } }).find("span").classes().join(" ");
      expect(cls, status).not.toMatch(/\bcapitalize\b/);
      expect(cls, status).not.toMatch(/\buppercase\b/);
    }
  });

  it("falls back to the raw status rather than rendering nothing", () => {
    expect(mount(LoadStatusBadge, { props: { status: "not_a_status" } }).text()).toBe("not_a_status");
  });
});

describe("the finding tier vocabulary is mapped, not case-transformed", () => {
  it("says what the tier means to a reviewer", () => {
    // `conditional` is the tier that stops a load auto-clearing; the badge names the consequence.
    expect(tierLabel("conditional")).toBe("Review");
    expect(tierLabel("violation")).toBe("Violation");
    expect(tierLabel("info")).toBe("Info");
  });

  it("shows an unmapped tier rather than hiding it", () => {
    expect(tierLabel("something_new")).toBe("something_new");
  });
});
