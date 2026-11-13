import { describe, expect, it } from "vitest";
import { reactive } from "vue";
import { WIZARD_SCREENS } from "@silvicom/shared";
import { emptyAccident, emptyDraft, type ApplicationDraft } from "@/features/apply/draft";
import { fieldId } from "@/features/apply/fieldLabels";
import type { SectionIssue } from "@/features/apply/useApplicationWizard";
import { DRAFT_BOUND_PATHS, draftBinding, draftPath } from "./draftFields";

/**
 * Part 2's draft as the generated screens see it (F4 PR 1b-1): every Stage 2 fact has a home and words,
 * a gate answers whether its list has rows, and an answer that closes a conditional screen empties it.
 */
function bound(issues: SectionIssue[] = []) {
  const draft = reactive<ApplicationDraft>(emptyDraft());
  return { draft, b: draftBinding(() => draft, () => issues) };
}

const issueAt = (path: (string | number)[], say: string): SectionIssue =>
  ({ path, key: String(path[0]), message: say, label: "", say, fieldId: fieldId(path), section: "safety" });

describe("Part 2's draft, for the generated screens", () => {
  it("has words for every field the catalogue puts on Stage 2's screens, and none for a field it does not", () => {
    const asked = WIZARD_SCREENS.filter((s) => s.stage === 2).flatMap((s) => s.fields.map((f) => f.fact.path));
    // Not vacuous: the driving record alone asks fifteen.
    expect(asked.length).toBeGreaterThan(10);
    expect([...DRAFT_BOUND_PATHS()].sort()).toEqual([...new Set(asked)].sort());
  });

  it("finds a row's column at the contract's own path, so the task's issues land on its box", () => {
    expect(draftPath("application.accidents[].nature", 2)).toEqual(["accidents", 2, "nature"]);
    expect(draftPath("application.licence_suspended")).toEqual(["licence_suspended"]);
  });

  it("reads and writes the row the screen is about", () => {
    const { draft, b } = bound();
    draft.accidents = [emptyAccident(), emptyAccident()];
    b.write("application.accidents[].nature", "Jackknifed", 1);
    expect(draft.accidents[1]!.nature).toBe("Jackknifed");
    expect(draft.accidents[0]!.nature).toBe("");
    expect(b.read("application.accidents[].nature", 1)).toBe("Jackknifed");
  });

  it("asks a gate as Yes or No with nothing chosen, read off what the draft holds", () => {
    const { draft, b } = bound();
    expect(b.read("application.declares_no_accidents")).toBeNull();
    draft.declares_no_accidents = true;
    expect(b.read("application.declares_no_accidents")).toBe(false);
    draft.declares_no_accidents = false;
    draft.accidents = [emptyAccident()];
    expect(b.read("application.declares_no_accidents")).toBe(true);
  });

  it("opens one blank row on Yes, and on No declares none and clears every row", () => {
    const { draft, b } = bound();
    b.write("application.declares_no_accidents", true);
    expect(draft.declares_no_accidents).toBe(false);
    expect(draft.accidents).toHaveLength(1);
    expect(draft.accidents[0]!.hazmat_spill).toBeNull();
    draft.accidents[0]!.nature = "Rear-ended";
    // A second Yes adds nothing: the driver already has their row.
    b.write("application.declares_no_accidents", true);
    expect(draft.accidents).toHaveLength(1);
    b.write("application.declares_no_accidents", false);
    expect(draft.declares_no_accidents).toBe(true);
    expect(draft.accidents).toEqual([]);
  });

  it("empties a story when the answer it explains becomes No (SCREEN-MAP 2.20a)", () => {
    const { draft, b } = bound();
    b.write("application.licence_ever_denied", true);
    b.write("application.licence_denial_detail", "Unpaid tickets in 2019");
    b.write("application.licence_ever_denied", true);
    expect(draft.licence_denial_detail).toBe("Unpaid tickets in 2019");
    b.write("application.licence_ever_denied", false);
    expect(draft.licence_denial_detail).toBe("");
  });

  it("shows the task's own problem under the box it is about — a gate's at its list", () => {
    const { b } = bound([issueAt(["accidents"], "Say whether you had any"), issueAt(["violations", 0, "state"], "Give the state")]);
    expect(b.error("application.declares_no_accidents")).toBe("Say whether you had any");
    expect(b.id("application.declares_no_accidents")).toBe(fieldId(["accidents"]));
    expect(b.error("application.violations[].state", 0)).toBe("Give the state");
    expect(b.error("application.violations[].state", 1)).toBeUndefined();
  });
});
