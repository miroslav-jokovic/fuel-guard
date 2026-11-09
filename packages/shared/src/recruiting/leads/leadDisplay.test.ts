import { describe, expect, it } from "vitest";
import { leadAnswerRows, leadChannelLabel, leadVerdictWhy } from "./leadDisplay.js";
import { CLASS_A_YEAR_BUCKETS, leadMatch, type LeadMatchVerdict, type LeadRequirement } from "./leadMatch.js";
import { metaFacts } from "./facts/meta.js";
import { HIRING_PROFILE_V1 } from "./hiringProfile.js";

const v = (requirement: LeadRequirement, verdict: LeadMatchVerdict["verdict"], detail: Record<string, unknown> = {}): LeadMatchVerdict =>
  ({ requirement, hard: true, verdict, evidence: null, detail });

describe("why a verdict is what it is", () => {
  it("has a sentence with no blanks for every verdict leadMatch can produce", () => {
    const forms: Array<Record<string, string>> = [{}, { class_a_held: "yes", class_a_years: "lt1", hazmat_endorsement: "no" }, { class_a_held: "no", class_a_years: "2to5", hazmat_endorsement: "yes" }];
    for (const answers of forms) {
      for (const verdict of leadMatch(HIRING_PROFILE_V1, metaFacts(answers), "2026-11-04")) {
        expect(leadVerdictWhy(verdict)).toMatch(/^[A-Z].*\.$/);
        expect(leadVerdictWhy(verdict)).not.toMatch(/undefined|null|NaN/);
      }
    }
  });

  it("says experience in the person's own terms, and that it still needs confirming", () => {
    const stated = CLASS_A_YEAR_BUCKETS["2to5"];
    expect(leadVerdictWhy(v("class_a_experience", "unknown", { min_years: 2, stated, needs: "verification" })))
      .toBe("They said 2 to 5 years. The requirement is 2 years, and it counts once an employer or the MVR confirms it.");
    expect(leadVerdictWhy(v("class_a_experience", "does_not_meet", { min_years: 2, stated: CLASS_A_YEAR_BUCKETS.lt1 })))
      .toBe("They said less than 1 year. The requirement is 2 years.");
    expect(leadVerdictWhy(v("class_a_experience", "unknown", { min_years: 1, stated: CLASS_A_YEAR_BUCKETS["5plus"], needs: "verification" })))
      .toContain("They said more than 5 years. The requirement is 1 year,");
  });

  it("tells a yes from a no from nothing said", () => {
    expect(leadVerdictWhy(v("class_a", "meets"))).toBe("They said they hold one.");
    expect(leadVerdictWhy(v("class_a", "does_not_meet"))).toBe("They said they don't hold one.");
    expect(leadVerdictWhy(v("hazmat", "unknown"))).toBe("They haven't said, so ask on the call.");
  });

  it("gives age from the stored figures", () => {
    expect(leadVerdictWhy(v("age", "does_not_meet", { min_years: 23, age: 21 }))).toBe("They are 21. The minimum is 23 years.");
    expect(leadVerdictWhy(v("age", "unknown", { min_years: 23 }))).toBe("Their age isn't on file, so ask on the call. The minimum is 23 years.");
  });
});

describe("a form's answers", () => {
  it("reads a key or a Spanish label back in English, and leaves out what the contact fields show", () => {
    expect(leadAnswerRows({ full_name: "Ray", phone_number: "+1", class_a_years: "De 2 a 5 años", hazmat_endorsement: "yes" })).toEqual([
      { key: "class_a_years", question: "How many years of Class A driving experience do you have?", answer: "2 to 5 years" },
      { key: "hazmat_endorsement", question: "Do you have a hazmat (H) endorsement?", answer: "Yes" },
    ]);
  });

  it("shows an answer outside the catalogue as it was sent, never dropping it", () => {
    expect(leadAnswerRows({ preferred_shift: "Nights", class_a_held: "maybe" })).toEqual([
      { key: "preferred_shift", question: "preferred shift", answer: "Nights" },
      { key: "class_a_held", question: "Do you hold a valid Class A CDL?", answer: "maybe" },
    ]);
  });
});

describe("a channel's name", () => {
  it("has a label, or reads as words when it has none yet", () => {
    expect(leadChannelLabel("meta")).toBe("Meta ad");
    expect(leadChannelLabel("job_board")).toBe("job board");
  });
});
