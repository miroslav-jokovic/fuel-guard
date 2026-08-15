import { describe, expect, it } from "vitest";
import { decidePromotion, type OrgObservation, type ProofEvidence } from "./promote.js";

/**
 * Step 4.6's rule, tested as data.
 *
 * This function decides whether code may touch a customer's fuel cards. Every case here is a way it
 * could say yes when it should say no — which is the only direction that costs anything.
 */

const greenProof = (over: Partial<ProofEvidence> = {}): ProofEvidence => ({
  outcome: "proven",
  oeg1Entitled: true,
  oeg2bNoopStable: true,
  oeg3ChangeLanded: true,
  oeg4Vocabulary: true,
  oeg5RevertLanded: true,
  documentShape: "nested:header",
  vocabulary: { status: ["ACTIVE", "HOLD"] },
  ...over,
});

const org = (over: Partial<OrgObservation> = {}): OrgObservation => ({
  observedDocumentShape: "nested:header",
  scanVerdicts: { status: "match" },
  ...over,
});

describe("the three refusals Step 4.6 names", () => {
  it("refuses when the document shape differs", () => {
    const decision = decidePromotion("card_lock", greenProof({ documentShape: "flat" }), org());

    // A proof is evidence for the environment that produced it. Promoting a flat-document proof onto
    // a nested org means the serializer paths that were exercised are not the ones that will run.
    expect(decision.allowed).toBe(false);
    expect(decision.refusals.join(" ")).toMatch(/"flat" document and this company returns "nested:header"/);
  });

  it("refuses when a vocabulary field is unobserved and the proof did not observe it either", () => {
    const decision = decidePromotion(
      "card_lock",
      greenProof({ vocabulary: {} }),
      org({ scanVerdicts: { status: "unobserved" } }),
    );

    expect(decision.allowed).toBe(false);
    expect(decision.refusals.join(" ")).toMatch(/UNOBSERVED.*No evidence is not evidence/s);
  });

  it("allows a fully green proof — the pair, so the refusals above cannot pass for the wrong reason", () => {
    const decision = decidePromotion("card_lock", greenProof(), org());

    expect(decision.allowed).toBe(true);
    expect(decision.refusals).toEqual([]);
  });
});

describe("the amendment Step 4.4 forced", () => {
  it("accepts an unobserved field when the PROOF observed it", () => {
    // QA reports `card_lock.status` unobserved because no QA card is in HOLD right now, and rule 14
    // guarantees none stays there. Under the rule as written, the safest capability in the product —
    // already verified live twice — could never be promoted.
    const decision = decidePromotion(
      "card_lock",
      greenProof({ vocabulary: { status: ["HOLD"] } }),
      org({ scanVerdicts: { status: "unobserved" } }),
    );

    expect(decision.allowed).toBe(true);
    // Accepted, and SAID SO. The promotion carries why it was allowed on weaker fleet-wide evidence.
    expect(decision.residualRisks.join(" ")).toMatch(/unobserved fleet-wide; accepted on the proof run/);
  });

  it("still refuses a MISMATCH, whatever the proof observed", () => {
    // The amendment relaxes "no evidence". It must not relax "evidence that we are wrong": a
    // mis-spelling means the next write of that value is silently ignored, which is H1 exactly.
    const decision = decidePromotion(
      "card_lock",
      greenProof({ vocabulary: { status: ["HOLD"] } }),
      org({ scanVerdicts: { status: "mismatch" } }),
    );

    expect(decision.allowed).toBe(false);
    expect(decision.refusals.join(" ")).toMatch(/MISMATCH/);
  });
});

describe("a gate that was never reached is not a gate that passed", () => {
  for (const gate of ["oeg1Entitled", "oeg3ChangeLanded", "oeg4Vocabulary", "oeg5RevertLanded"] as const) {
    it(`refuses when ${gate} is null`, () => {
      const decision = decidePromotion("card_lock", greenProof({ [gate]: null }), org());

      // The columns are nullable precisely so "not reached" and "false" stay distinguishable. Reading
      // a null as a pass is the single most expensive mistake this function could make.
      expect(decision.allowed).toBe(false);
      expect(decision.refusals.join(" ")).toMatch(/not obtained/);
    });
  }

  it("carries a null OEG-2b as a recorded risk instead of blocking", () => {
    const decision = decidePromotion("card_lock", greenProof({ oeg2bNoopStable: null }), org());

    // OEG-2b needs a no-op DISPATCH, which the capability model cannot express and which docs/24
    // §3.2 says is never obtainable on production at all. Blocking on it would block every
    // production promotion forever; waiving it silently would lose the fact. So: recorded.
    expect(decision.allowed).toBe(true);
    expect(decision.residualRisks.join(" ")).toMatch(/OEG-2b.*not obtained.*Recorded, not waived/s);
  });

  it("refuses a proof that did not settle `proven`", () => {
    const decision = decidePromotion("card_lock", greenProof({ outcome: "void" }), org());

    expect(decision.allowed).toBe(false);
    expect(decision.refusals.join(" ")).toMatch(/settled "void"/);
  });

  it("refuses when no proof exists at all", () => {
    const decision = decidePromotion("card_lock", null, org());

    expect(decision.allowed).toBe(false);
    expect(decision.refusals[0]).toMatch(/No proof run exists/);
  });

  it("refuses when the company's own shape has never been scanned", () => {
    const decision = decidePromotion("card_lock", greenProof(), org({ observedDocumentShape: null }));

    // Refused rather than defaulted. A guessed shape is a proof matched against a fiction.
    expect(decision.allowed).toBe(false);
    expect(decision.refusals.join(" ")).toMatch(/has not been recorded/);
  });
});

describe("what it reports", () => {
  it("lists every reason it found, not the first one", () => {
    const decision = decidePromotion(
      "card_lock",
      greenProof({ documentShape: "flat", oeg3ChangeLanded: false }),
      org({ scanVerdicts: { status: "mismatch" } }),
    );

    // An operator who fixes the shape, re-runs, and is then told about OEG-3 has done the work
    // twice — and the second refusal looks like the fix broke something.
    expect(decision.refusals).toHaveLength(3);
  });

  it("reports the real override_grant situation truthfully", () => {
    // The capability the whole phase was reordered around. `overrideAllLocations` is unobserved
    // fleet-wide (H3) and `judge` returns `indeterminate`, so OEG-3 cannot come back true — which
    // means override_grant is unpromotable today, and SHOULD be.
    const decision = decidePromotion(
      "override_grant",
      greenProof({ oeg3ChangeLanded: null, vocabulary: {} }),
      org({ scanVerdicts: { overrideAllLocations: "unobserved" } }),
    );

    expect(decision.allowed).toBe(false);
    expect(decision.refusals.join(" ")).toMatch(/OEG-3.*not obtained/);
    expect(decision.refusals.join(" ")).toMatch(/overrideAllLocations.*UNOBSERVED/);
  });
});

describe("a refusal names EVERY blocker, not the first one (observed live 2026-08-15)", () => {
  /**
   * Watched happen against the production org, which is the most common starting state: never
   * promoted, no proof, no config scan. The gate refused — correct — and named ONLY the missing
   * proof, while the route's own comment promises "Every reason is returned, so one round trip tells
   * them everything they have to fix."
   *
   * The two blockers have DIFFERENT fixes: a proof run, and a config scan. An operator who learned
   * one at a time would have run the proof, re-run the promotion, and only then met the second wall.
   */
  const virgin = { observedDocumentShape: null, scanVerdicts: {} };

  it("reports the missing document shape even when there is no proof", () => {
    const decision = decidePromotion("card_lock", null, virgin);

    expect(decision.allowed).toBe(false);
    // THREE, and the live run returned one. Each has a DIFFERENT fix: run a proof, run a config
    // scan, and get an observation of `status` — the last either from a scan that catches a card in
    // HOLD or from the proof run's own write.
    expect(decision.refusals).toHaveLength(3);
    expect(decision.refusals.join(" ")).toContain("No proof run exists");
    // THE regression. Before this change the assessment returned early and neither of the next two
    // was ever reached.
    expect(decision.refusals.join(" ")).toContain("document shape has not been recorded");
    expect(decision.refusals.join(" ")).toContain("UNOBSERVED");
  });

  it("does not pad the list with proof gates it could not have evaluated", () => {
    // "OEG-1 is not obtained" adds nothing to "there is no proof", and four of them would bury the
    // one refusal that carries an independent fix. Skipped as noise, not reported as findings.
    const decision = decidePromotion("card_lock", null, virgin);

    expect(decision.refusals.join(" ")).not.toContain("OEG-1");
    expect(decision.refusals.join(" ")).not.toContain("OEG-5");
  });

  it("still reports only the proof when the org side is already satisfied", () => {
    const decision = decidePromotion("card_lock", null, {
      observedDocumentShape: "nested:header",
      scanVerdicts: { status: "match" },
    });

    // The list grows and shrinks with what is actually wrong — it is not "always report everything".
    expect(decision.refusals).toHaveLength(1);
    expect(decision.refusals[0]).toContain("No proof run exists");
  });

  it("survives a missing proof while judging vocabulary, rather than throwing", () => {
    // `proof.vocabulary[field]` was an unguarded dereference on a path that could not previously be
    // reached with a null proof. Making the assessment continue is what makes it reachable.
    const decision = decidePromotion("card_lock", null, {
      observedDocumentShape: "nested:header",
      scanVerdicts: { status: "unobserved" },
    });

    expect(decision.allowed).toBe(false);
    expect(decision.refusals.join(" ")).toContain("No proof run exists");
  });
});
