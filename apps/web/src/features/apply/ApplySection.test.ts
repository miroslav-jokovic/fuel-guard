import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { emptyDraft } from "./draft";
import ApplySection from "./ApplySection.vue";
import { APPLY_COPY } from "./strings";

/** The review screen opens with the §391.21(d) notice (C3c2a); no other screen carries it. */
const at = (section: "review" | "identity") =>
  mount(ApplySection, {
    props: { modelValue: emptyDraft(), section, token: "t", captures: [], asOf: "2026-09-26", identityLockedBy: null },
  }).text();

describe("ApplySection", () => {
  it("puts the notice before sending on the review screen, and only there", () => {
    expect(at("review")).toContain(APPLY_COPY.employerCheck.heading);
    expect(at("identity")).not.toContain(APPLY_COPY.employerCheck.heading);
  });
});
