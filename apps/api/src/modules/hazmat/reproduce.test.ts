import { describe, it, expect } from "vitest";
import type { Verdict } from "@hazmat/engine";
import { decisionsMatch, diffVerdicts, stripNonDecision } from "./reproduce.js";

/**
 * M12.2's comparison, which had no test at all.
 *
 * ⚠ The danger in a "did the decision reproduce?" claim is that it is BELIEVED. It is the sentence
 * under the packet's provenance line, so a false "the decision is unchanged" is worse than no claim:
 * it is the one a reviewer stops checking. Everything here exists to hold that claim honest.
 *
 * `decisionIdentical` is deliberately SUBTRACTIVE — it compares the whole verdict minus a named list
 * of fields that carry no decision. The alternative, enumerating what to compare, is what
 * `diffVerdicts` does, and `diffVerdicts` is consequently blind to `placards.marks`: it was written
 * before the engine emitted any. A rule added tomorrow lands inside a subtractive comparison for
 * free and outside an additive one silently.
 */
const verdict = (over: Record<string, unknown> = {}): Verdict =>
  ({
    engineVersion: "0.13.0",
    datasetVersion: "2026.07.1",
    placards: {
      required: [{ placard: "FLAMMABLE", positions: "each side and each end", because: [] }],
      permitted: [], optionalSubstitutions: [], prohibited: [], idDisplays: [], ergGuides: [], marks: [],
    },
    eligibility: { status: "not_checked", blocks: [] },
    segregation: [],
    notices: [],
    trace: [],
    ...over,
  }) as unknown as Verdict;

describe("decisionsMatch — what may differ", () => {
  it("ignores an added explanation, which is why this exists", () => {
    const before = verdict({ notices: [] });
    const after = verdict({ notices: [{ ruleId: "below_1001lb_no_placard", tier: "info", message: "…", citations: [] }] });
    expect(decisionsMatch(before, after)).toBe(true);
  });

  it("ignores a verdict recorded before notices existed, where the key is absent entirely", () => {
    const old = verdict();
    delete (old as unknown as Record<string, unknown>).notices;
    expect(decisionsMatch(old, verdict({ notices: [{ ruleId: "x", tier: "info", message: "…", citations: [] }] }))).toBe(true);
  });

  it("ignores the rule trace, which is evidence of the answer rather than the answer", () => {
    expect(decisionsMatch(verdict(), verdict({ trace: [{ ruleId: "r", fired: true, inputs: {}, citations: [] }] }))).toBe(true);
  });

  it("ignores the version stamps", () => {
    expect(decisionsMatch(verdict(), verdict({ engineVersion: "9.9.9", datasetVersion: "2099.01.0" }))).toBe(true);
  });
});

describe("decisionsMatch — what may NOT differ", () => {
  const placards = (over: Record<string, unknown>) => verdict({ placards: { ...verdict().placards, ...over } });

  it("catches a changed placard", () => {
    expect(decisionsMatch(verdict(), placards({ required: [] }))).toBe(false);
  });

  /**
   * The case that decided the design. `diffVerdicts` never learned about marks, so a MARINE POLLUTANT
   * mark appearing or vanishing — absolutely a change to what goes on the truck — is invisible to it.
   * A subtractive comparison catches it without having been told marks exist.
   */
  it("catches a MARINE POLLUTANT mark appearing, which the enumerated diff cannot see", () => {
    const marked = placards({ marks: [{ mark: "MARINE_POLLUTANT", positions: "each side and each end", because: [] }] });
    expect(decisionsMatch(verdict(), marked)).toBe(false);
    // …and here is the blindness it is guarding against:
    const diff = diffVerdicts(verdict(), marked);
    expect(diff.placardsAdded).toEqual([]);
    expect(diff.findingsAdded).toEqual([]);
  });

  it("catches a changed ID display", () => {
    expect(decisionsMatch(verdict(), placards({ idDisplays: [{ idNumber: "UN1203", format: "on_placard", positions: "", onPlacards: [], alternateFormats: [], because: [] }] }))).toBe(false);
  });

  it("catches a changed eligibility status", () => {
    expect(decisionsMatch(verdict(), verdict({ eligibility: { status: "blocked", blocks: [] } }))).toBe(false);
  });

  it("catches a blocking finding appearing", () => {
    const blocked = verdict({ eligibility: { status: "not_checked", blocks: [{ ruleId: "aggregate_weight_unknown", tier: "conditional", message: "…", citations: [] }] } });
    expect(decisionsMatch(verdict(), blocked)).toBe(false);
  });

  it("catches a segregation finding appearing", () => {
    expect(decisionsMatch(verdict(), verdict({ segregation: [{ ruleId: "segregation_conflict", tier: "violation", message: "…", citations: [] }] }))).toBe(false);
  });

  it("catches a field the comparison was never taught about", () => {
    // The whole point of subtracting rather than enumerating: an unknown key still counts.
    expect(decisionsMatch(verdict(), verdict({ somethingAddedLater: { placards: "changed" } }))).toBe(false);
  });
});

describe("stripNonDecision keeps the decision", () => {
  it("removes exactly the four non-decision fields and nothing else", () => {
    const kept = Object.keys(stripNonDecision(verdict())).sort();
    expect(kept).toEqual(["eligibility", "placards", "segregation"]);
  });
});
