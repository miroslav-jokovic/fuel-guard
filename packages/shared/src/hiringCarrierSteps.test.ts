import { describe, it, expect } from "vitest";
import { carrierHireBlockers, hireBlockers, hiringChecklist, type HiringChecklistInputs } from "./hiringChecklist.js";
import { HIRING_STEPS, type HiringStepKey } from "./hiringSteps.js";
import {
  CARRIER_STEP_ANCHORS,
  HIDEABLE_HIRING_STEPS,
  HIDEABLE_ROW_STEPS,
  carrierStepCreateSchema,
  carrierStepRecordSchema,
  carrierStepUpdateSchema,
  hiddenHiringSteps,
  hiddenHiringStepsSchema,
  type CarrierStep,
  type CarrierStepLatest,
} from "./carrierStepsContract.js";
import { APPLICATION_RELEASE_ORDER } from "./applicationIntake.js";
import { packetDriverMarkCount } from "./packetPlacements.js";

/**
 * The carrier's own steps and the built-in steps it does not run (HIRING-WORKFLOW-AUDIT §10 CE2).
 * Fixtures built from the real catalogues, as `hiringChecklist.test.ts`'s header asks.
 */

const ALL_PERMISSIONS = APPLICATION_RELEASE_ORDER.map((purpose) => ({
  id: `${purpose}-1`, purpose, accepted_at: "2026-09-01T00:00:00Z", revokes: null,
}));

/** Everything the schema can see done, except the hire itself. */
const ready = (over: Partial<HiringChecklistInputs> = {}): HiringChecklistInputs => ({
  invitedAt: "2026-09-01T00:00:00Z",
  intake: { v2: true, completedAt: "2026-09-01T06:00:00Z" },
  phases: {
    applicationSentAt: "2026-09-01T12:00:00Z", reviewRequestedAt: "2026-09-02T00:00:00Z",
    approvedAt: "2026-09-03T00:00:00Z", signingOpenedAt: "2026-09-08T00:00:00Z", submittedAt: null,
  },
  authorizations: ALL_PERMISSIONS,
  qualificationKinds: ["mvr", "clearinghouse_full", "drug_test", "medical_registry_verification", "road_test", "handbook"],
  psp: { requested: true, reportReceived: true },
  packetMarks: packetDriverMarkCount(null),
  investigation: { outstanding: 0, awaiting: 0 },
  travelBooked: true,
  hiredAt: null,
  ...over,
});

const step = (id: string, over: Partial<CarrierStep> = {}): CarrierStep => ({
  id, label: id, instructions: null, after_step: "road_test", position: 0, owes: "us", proof: "tick",
  blocks_hire: false, created_at: "2026-11-01T00:00:00Z", retired_at: null, ...over,
});
const act = (stepId: string, a: "done" | "undone" = "done", over: Partial<CarrierStepLatest> = {}): CarrierStepLatest => ({
  stepId, act: a, at: "2026-11-02T00:00:00Z", byName: "Dana", note: a === "undone" ? "mistake" : null, documentId: null, ...over,
});

describe("the hideable steps (D-CE3)", () => {
  it("are derived from the catalogue and never include a federal check, a refusing step or the hire", () => {
    expect(HIDEABLE_HIRING_STEPS).toEqual(["psp", "orientation_videos", "travel_booked", "live_orientation", "handbook"]);
    // §14 D-OF1: Settings offers rows only; the schema's list stays whole so stored settings still save.
    expect(HIDEABLE_ROW_STEPS).toEqual(["psp", "orientation_videos", "travel_booked", "handbook"]);
    for (const k of HIDEABLE_HIRING_STEPS) {
      const spec = HIRING_STEPS.find((s) => s.key === k)!;
      expect(spec.federalGate).toBe(false);
      expect(k).not.toBe("hired");
    }
    expect(HIDEABLE_HIRING_STEPS).not.toContain("permissions_signed");
    expect(HIDEABLE_HIRING_STEPS).not.toContain("employment_investigation");
  });

  it("a stored list naming a locked step hides nothing of it", () => {
    expect([...hiddenHiringSteps(["drug_test", "hired", "psp", "nonsense"])]).toEqual(["psp"]);
  });

  it("the settings schema refuses a locked key", () => {
    expect(hiddenHiringStepsSchema.safeParse(["drug_test"]).success).toBe(false);
    expect(hiddenHiringStepsSchema.parse(["psp", "psp"])).toEqual(["psp"]);
  });

  it("a hidden step leaves the rows, the travel range and the hire's list", () => {
    const shown = hiringChecklist(ready({ psp: null, hirePolicy: { handbook_blocks_hire: true }, qualificationKinds: ["mvr", "clearinghouse_full", "drug_test", "medical_registry_verification", "road_test"] }));
    expect(shown.readyToTravel.outstanding).toContain("psp");
    expect(hireBlockers(shown)).toContain("handbook");

    const c = hiringChecklist(ready({ psp: null, hiddenSteps: ["psp", "handbook"], hirePolicy: { handbook_blocks_hire: true }, qualificationKinds: ["mvr", "clearinghouse_full", "drug_test", "medical_registry_verification", "road_test"] }));
    expect(c.steps.map((s) => s.key)).not.toContain("psp");
    expect(c.steps.map((s) => s.key)).not.toContain("handbook");
    expect(c.hidden).toEqual(["psp", "handbook"]);
    expect(c.readyToTravel.outstanding).not.toContain("psp");
    expect(c.readyToTravel.unmeasured).not.toContain("psp");
    expect(hireBlockers(c)).toEqual([]);
    expect(c.readyToHire.ok).toBe(true);
  });

  it("a hidden list naming a federal check leaves it on the checklist and holding the hire", () => {
    const c = hiringChecklist(ready({ hiddenSteps: ["drug_test"], qualificationKinds: ["mvr", "clearinghouse_full", "medical_registry_verification", "road_test"] }));
    expect(c.steps.map((s) => s.key)).toContain("drug_test");
    expect(hireBlockers(c)).toContain("drug_test");
    expect(c.hidden).toEqual([]);
  });

  // §14 D-OF3: the live orientation day is off the list, so it is never "not built yet", hidden or not.
  it("an unlisted step never counts as unbuilt, hidden or not", () => {
    expect(hiringChecklist(ready()).unbuilt).not.toContain("live_orientation");
    expect(hiringChecklist(ready({ hiddenSteps: ["live_orientation"] })).unbuilt).not.toContain("live_orientation");
  });
});

describe("the carrier's own steps (D-CE1, D-CE5, D-CE6)", () => {
  it("show after the step they were placed after, in the office's order, and count in the total", () => {
    const base = hiringChecklist(ready());
    const c = hiringChecklist(ready({
      carrierSteps: {
        steps: [step("b", { position: 2 }), step("a", { position: 1 }), step("hair", { after_step: "drug_test" })],
        latest: [],
      },
    }));
    expect(c.carrierSteps.map((s) => s.id)).toEqual(["hair", "a", "b"]);
    expect(c.carrierSteps.map((s) => s.showAfter)).toEqual(["drug_test", "road_test", "road_test"]);
    expect(c.total).toBe(base.total + 3);
    expect(c.done).toBe(base.done);
    const oneDone = hiringChecklist(ready({ carrierSteps: { steps: [step("a"), step("b")], latest: [act("a")] } }));
    expect(oneDone.done).toBe(base.done + 1);
    expect(oneDone.total).toBe(base.total + 2);
  });

  it("a step placed after a hidden built-in shows where that one would have been", () => {
    const c = hiringChecklist(ready({ hiddenSteps: ["handbook"], carrierSteps: { steps: [step("x", { after_step: "handbook" })], latest: [] } }));
    const at = HIRING_STEPS.findIndex((s) => s.key === "handbook");
    const shownBefore = c.steps.map((s) => s.key).filter((k) => HIRING_STEPS.findIndex((s) => s.key === k) <= at);
    expect(c.carrierSteps[0]!.showAfter).toBe(shownBefore[shownBefore.length - 1]);
    expect(c.carrierSteps[0]!.showAfter).not.toBe("handbook");
  });

  it("a place the catalogue does not have still shows, before the hire", () => {
    const c = hiringChecklist(ready({ carrierSteps: { steps: [step("x", { after_step: "gone_step" })], latest: [] } }));
    expect(c.carrierSteps).toHaveLength(1);
    expect(c.carrierSteps[0]!.showAfter).not.toBe("hired");
    expect(c.carrierSteps[0]!.showAfter).not.toBeNull();
  });

  it("the latest act is the answer — done, then taken back, reads open again", () => {
    const facts = (latest: CarrierStepLatest[]) => ({ steps: [step("x"), step("y", { owes: "them" })], latest });
    expect(hiringChecklist(ready({ carrierSteps: facts([act("x")]) })).carrierSteps[0]!.state).toBe("done");
    const undone = hiringChecklist(ready({ carrierSteps: facts([act("x", "undone")]) })).carrierSteps[0]!;
    expect(undone.state).toBe("waiting_on_us");
    expect(undone.record?.note).toBe("mistake");
    expect(hiringChecklist(ready({ carrierSteps: facts([]) })).carrierSteps[1]!.state).toBe("waiting_on_them");
  });

  it("a step switched to hold the hire holds it until done, and readyToHire says so", () => {
    const facts = (latest: CarrierStepLatest[]) => ({ steps: [step("fuel", { blocks_hire: true }), step("tablet")], latest });
    const open = hiringChecklist(ready({ carrierSteps: facts([]) }));
    expect(carrierHireBlockers(open).map((s) => s.id)).toEqual(["fuel"]);
    expect(open.readyToHire.ok).toBe(false);
    expect(open.readyToHire.carrierOutstanding).toEqual(["fuel"]);
    expect(open.readyToHire.outstanding).toEqual([]);

    const done = hiringChecklist(ready({ carrierSteps: facts([act("fuel")]) }));
    expect(carrierHireBlockers(done)).toEqual([]);
    expect(done.readyToHire.ok).toBe(true);
  });

  it("a retired step neither shows nor holds the hire", () => {
    const c = hiringChecklist(ready({ carrierSteps: { steps: [step("old", { blocks_hire: true, retired_at: "2026-11-02T00:00:00Z" })], latest: [] } }));
    expect(c.carrierSteps).toEqual([]);
    expect(c.readyToHire.ok).toBe(true);
  });

  it("a carrier with no steps changes nothing", () => {
    const a = hiringChecklist(ready());
    const b = hiringChecklist(ready({ carrierSteps: { steps: [], latest: [] }, hiddenSteps: [] }));
    expect(b).toEqual(a);
  });
});

describe("the contract", () => {
  it("nothing may be placed after the hire", () => {
    expect(CARRIER_STEP_ANCHORS).not.toContain("hired" as HiringStepKey);
    expect(carrierStepCreateSchema.safeParse({ label: "x", afterStep: "hired" }).success).toBe(false);
    expect(carrierStepCreateSchema.parse({ label: " Hair test ", afterStep: "drug_test" })).toEqual({
      label: "Hair test", instructions: null, afterStep: "drug_test", owes: "us", proof: "tick", blocksHire: false,
    });
  });

  it("the update cannot change what proves a step", () => {
    const parsed = carrierStepUpdateSchema.parse({ label: "x", proof: "document" } as Record<string, unknown>);
    expect(parsed).not.toHaveProperty("proof");
    expect(carrierStepUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("an undo needs a reason and carries no paper", () => {
    expect(carrierStepRecordSchema.safeParse({ act: "undone" }).success).toBe(false);
    expect(carrierStepRecordSchema.safeParse({ act: "undone", note: "  " }).success).toBe(false);
    expect(carrierStepRecordSchema.safeParse({ act: "undone", note: "x", documentId: "6f1c1e0e-8a5b-4c1e-9a1e-2b2b2b2b2b2b" }).success).toBe(false);
    expect(carrierStepRecordSchema.parse({ act: "done" })).toEqual({ act: "done", note: null, documentId: null });
  });
});
