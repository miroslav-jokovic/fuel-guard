import { describe, expect, it } from "vitest";
import { decidePromotion, type OrgObservation, type ProofEvidence, type PromotionAuthority } from "./promote.js";

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

const MAKER = "11111111-2222-4333-8444-555555555555";
const CHECKER = "66666666-7777-4888-8999-aaaaaaaaaaaa";

/**
 * Default: sandbox, and two different people. Chosen so Step 5.3's rule is SILENT here — it adds no
 * refusal and no residual risk — and every case below still tests exactly what it was written to
 * test. The separation rule has its own describe block at the end.
 */
const authority = (over: Partial<PromotionAuthority> = {}): PromotionAuthority => ({
  promoterId: CHECKER,
  proofRunBy: MAKER,
  environment: "sandbox",
  ...over,
});

describe("the three refusals Step 4.6 names", () => {
  it("refuses when the document shape differs", () => {
    const decision = decidePromotion("card_lock", greenProof({ documentShape: "flat" }), org(), authority());

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
      authority(),
    );

    expect(decision.allowed).toBe(false);
    expect(decision.refusals.join(" ")).toMatch(/UNOBSERVED.*No evidence is not evidence/s);
  });

  it("allows a fully green proof — the pair, so the refusals above cannot pass for the wrong reason", () => {
    const decision = decidePromotion("card_lock", greenProof(), org(), authority());

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
      authority(),
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
      authority(),
    );

    expect(decision.allowed).toBe(false);
    expect(decision.refusals.join(" ")).toMatch(/MISMATCH/);
  });
});

describe("a gate that was never reached is not a gate that passed", () => {
  for (const gate of ["oeg1Entitled", "oeg3ChangeLanded", "oeg4Vocabulary", "oeg5RevertLanded"] as const) {
    it(`refuses when ${gate} is null`, () => {
      const decision = decidePromotion("card_lock", greenProof({ [gate]: null }), org(), authority());

      // The columns are nullable precisely so "not reached" and "false" stay distinguishable. Reading
      // a null as a pass is the single most expensive mistake this function could make.
      expect(decision.allowed).toBe(false);
      expect(decision.refusals.join(" ")).toMatch(/not obtained/);
    });
  }

  it("carries a null OEG-2b as a recorded risk instead of blocking", () => {
    const decision = decidePromotion("card_lock", greenProof({ oeg2bNoopStable: null }), org(), authority());

    // OEG-2b needs a no-op DISPATCH, which the capability model cannot express and which docs/24
    // §3.2 says is never obtainable on production at all. Blocking on it would block every
    // production promotion forever; waiving it silently would lose the fact. So: recorded.
    expect(decision.allowed).toBe(true);
    expect(decision.residualRisks.join(" ")).toMatch(/OEG-2b.*not obtained.*Recorded, not waived/s);
  });

  it("refuses a proof that did not settle `proven`", () => {
    const decision = decidePromotion("card_lock", greenProof({ outcome: "void" }), org(), authority());

    expect(decision.allowed).toBe(false);
    expect(decision.refusals.join(" ")).toMatch(/settled "void"/);
  });

  it("refuses when no proof exists at all", () => {
    const decision = decidePromotion("card_lock", null, org(), authority());

    expect(decision.allowed).toBe(false);
    expect(decision.refusals[0]).toMatch(/No proof run exists/);
  });

  it("refuses when the company's own shape has never been scanned", () => {
    const decision = decidePromotion("card_lock", greenProof(), org({ observedDocumentShape: null }), authority());

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
      authority(),
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
      authority(),
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
    const decision = decidePromotion("card_lock", null, virgin, authority());

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
    const decision = decidePromotion("card_lock", null, virgin, authority());

    expect(decision.refusals.join(" ")).not.toContain("OEG-1");
    expect(decision.refusals.join(" ")).not.toContain("OEG-5");
  });

  it("still reports only the proof when the org side is already satisfied", () => {
    const decision = decidePromotion("card_lock", null, {
      observedDocumentShape: "nested:header",
      scanVerdicts: { status: "match" },
    },
      authority(),
    );

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
    },
      authority(),
    );

    expect(decision.allowed).toBe(false);
    expect(decision.refusals.join(" ")).toContain("No proof run exists");
  });
});

/**
 * Step 5.3 — separation of duties on the act that matters.
 *
 * `approved_by` had existed on the mutation ledger since 0177 with nothing writing it, and the plan
 * asks who may promote a capability to production. Card mutations cannot answer it yet — plan and
 * apply are one request, so a second principal does not exist to demand. A promotion can: the proof
 * run and the promotion are already two endpoints, two rows and two moments.
 */
describe("who may promote a capability to production", () => {
  it("refuses on production when the promoter ran the proof they are citing", () => {
    const decision = decidePromotion("card_lock", greenProof(), org(), authority({
      environment: "production",
      promoterId: MAKER,
      proofRunBy: MAKER,
    }));

    expect(decision.allowed).toBe(false);
    expect(decision.refusals.join(" ")).toMatch(/needs a second person/);
  });

  it("allows it on production when a different person produced the evidence", () => {
    const decision = decidePromotion("card_lock", greenProof(), org(), authority({
      environment: "production",
      promoterId: CHECKER,
      proofRunBy: MAKER,
    }));

    expect(decision.allowed).toBe(true);
    expect(decision.refusals).toEqual([]);
  });

  it("refuses on production when the proof no longer records who ran it, and names the fix", () => {
    // `run_by` is `on delete set null`. A null means separation cannot be established either way, and
    // this is the highest-privilege act in the product — so it fails closed rather than open. The
    // refusal has to name the way out or it reads as an unexplained permanent block.
    const decision = decidePromotion("card_lock", greenProof(), org(), authority({
      environment: "production",
      proofRunBy: null,
    }));

    expect(decision.allowed).toBe(false);
    expect(decision.refusals.join(" ")).toMatch(/Run a fresh proof and cite that one/);
  });

  it("permits self-promotion outside production, and records it as a residual risk", () => {
    // QA is where one person legitimately runs the proof and promotes it. Blocking that would stop
    // the work this rule exists to make safe — but a silent yes is the answer nobody can check later.
    const decision = decidePromotion("card_lock", greenProof(), org(), authority({
      environment: "sandbox",
      promoterId: MAKER,
      proofRunBy: MAKER,
    }));

    expect(decision.allowed).toBe(true);
    expect(decision.residualRisks.join(" ")).toMatch(/Self-approved/);
  });

  it("says nothing at all when two different people are involved outside production", () => {
    const decision = decidePromotion("card_lock", greenProof(), org(), authority());

    expect(decision.allowed).toBe(true);
    expect(decision.residualRisks.join(" ")).not.toMatch(/Self-approved/);
  });

  it("reports the separation refusal ALONGSIDE the evidence refusals, not instead of them", () => {
    // One round trip tells the operator everything they have to fix — the property the whole
    // function is built around. A `return` in the separation branch would have broken it.
    const decision = decidePromotion("card_lock", greenProof({ documentShape: "flat" }), org(), authority({
      environment: "production",
      promoterId: MAKER,
      proofRunBy: MAKER,
    }));

    expect(decision.refusals.join(" ")).toMatch(/"flat" document/);
    expect(decision.refusals.join(" ")).toMatch(/needs a second person/);
  });
});
