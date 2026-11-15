import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { emptyDraft } from "./draft";
import ApplySection from "./ApplySection.vue";
import { APPLY_COPY } from "./strings";

/** The review screen opens with the §391.21(d) notice (C3c2a); no other screen carries it. */
const at = (section: "review" | "licence" | "documents") =>
  mount(ApplySection, {
    props: { modelValue: emptyDraft(), section, token: "t", captures: [], asOf: "2026-09-26", v2AsOf: "2026-09-26", identityLockedBy: null },
  }).text();

describe("ApplySection", () => {
  it("puts the notice before sending on the review screen, and only there", () => {
    expect(at("review")).toContain(APPLY_COPY.employerCheck.heading);
    expect(at("licence")).not.toContain(APPLY_COPY.employerCheck.heading);
    expect(at("documents")).not.toContain(APPLY_COPY.employerCheck.heading);
  });

  /**
   * ⚠ A walked task with no walk to draw it shows NOTHING, never the review. The five walked tasks
   * (`GENERATED_TASKS`) are drawn by `TaskWalk`; until 1b-5 each had a legacy screen behind it, and the
   * chain ended in a bare `v-else` that was the review. With those screens gone, that `v-else` would
   * have put "Before you send" — and its Send button's summary — on a task that failed to open.
   */
  it("draws nothing for a walked task when there is no walk, and never the review in its place", () => {
    for (const section of ["identity", "addresses", "employment", "safety", "questions"] as const) {
      const w = mount(ApplySection, {
        props: { modelValue: emptyDraft(), section, token: "t", captures: [], asOf: "2026-09-26", v2AsOf: "2026-09-26", identityLockedBy: null },
      });
      expect(w.text(), section).toBe("");
    }
  });
});
