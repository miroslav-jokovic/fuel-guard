import { CARD_CAPABILITY_CONTRACTS } from "@fuelguard/shared";

/**
 * May this capability be promoted to `enabled` on this org? (Step 4.6)
 *
 * Pure, and separated from the endpoint on purpose: this is the rule that decides whether code may
 * touch a customer's fuel cards, and a rule embedded in a request handler is one that can only be
 * tested by standing up a request. Everything it needs arrives as data.
 *
 * ── The gate refuses by default and lists every reason it found ─────────────────────────────────
 * Not the first reason — all of them. An operator who fixes the shape mismatch and re-runs only to
 * be told about a vocabulary field has been made to do the work twice, and the second refusal looks
 * like the fix broke something.
 */

export interface ProofEvidence {
  outcome: string;
  oeg1Entitled: boolean | null;
  oeg2bNoopStable: boolean | null;
  oeg3ChangeLanded: boolean | null;
  oeg4Vocabulary: boolean | null;
  oeg5RevertLanded: boolean | null;
  documentShape: string | null;
  /** Raw spellings the proof run observed, per field, from the after-document. */
  vocabulary: Record<string, string[]>;
}

export interface OrgObservation {
  /** From the Step 4.4 scan, written onto `efs_card_control_settings`. */
  observedDocumentShape: string | null;
  /** Per vocabulary field, the three-state verdict the fleet-wide scan reached. */
  scanVerdicts: Record<string, "match" | "mismatch" | "unobserved">;
}

export interface PromotionDecision {
  allowed: boolean;
  refusals: string[];
  /** Facts recorded ON the promotion rather than blocking it — see OEG-2b. */
  residualRisks: string[];
}

/**
 * The four gates that must be TRUE, and the one that may be null.
 *
 * OEG-2b — "cardVersion unchanged after a no-op dispatch" — is not obtainable through the capability
 * model at all (Step 4.5 declined to fake it) and `docs/24` §3.2 says it is never obtainable on
 * production, because it needs a write. So a null is carried as a NAMED RESIDUAL RISK on the
 * promotion instead of blocking it. A null on any of the other four blocks: "not reached" is not
 * "passed", and the difference between them is the entire reason those columns are nullable.
 */
// `field`, not `key`. `{ key: "<something>" }` is the shape gitleaks' generic-api-key rule looks
// for, and it flagged this table as a committed credential — a false positive that failed CI on a
// list of OEG gate names. Renamed rather than allowlisted: an allowlist entry is a narrow hole in a
// secret scanner, and the standing rules say never widen a gate to make it green when the code can
// simply stop looking like the thing being detected.
const REQUIRED_GATES: { field: keyof ProofEvidence; label: string }[] = [
  { field: "oeg1Entitled", label: "OEG-1 (the account is entitled to the operations)" },
  { field: "oeg3ChangeLanded", label: "OEG-3 (the change landed and was seen on re-read)" },
  { field: "oeg4Vocabulary", label: "OEG-4 (the vendor spelled every vocabulary field as we sent it)" },
  { field: "oeg5RevertLanded", label: "OEG-5 (the card was put back, proven by re-read)" },
];

export function decidePromotion(
  capabilityKey: string,
  proof: ProofEvidence | null,
  org: OrgObservation,
): PromotionDecision {
  const refusals: string[] = [];
  const residualRisks: string[] = [];

  /**
   * ── A missing proof does not end the assessment (observed live 2026-08-15) ──────────────────────
   * This used to `return` here with that one refusal, and the route's own promise — "Every reason is
   * returned, so one round trip tells them everything they have to fix" — was therefore false on the
   * MOST COMMON starting state, a company that has never been promoted anything.
   *
   * Watched happen on production: the refusal named the missing proof and said nothing about the
   * missing document shape, which is an independent blocker needing an independent fix (a config
   * scan, not a proof run). An operator would have run the proof, re-run this, and only then met the
   * second wall. Two round trips to learn two facts that were both known on the first.
   *
   * So the proof-DEPENDENT checks below are skipped when there is no proof — they would be noise,
   * not findings, and "OEG-1 is not obtained" adds nothing to "there is no proof" — while every
   * ORG-level check still runs, because those are answerable without one.
   */
  if (!proof) {
    refusals.push(`No proof run exists for ${capabilityKey} on this company. Run one before promoting.`);
  }
  if (proof && proof.outcome !== "proven") {
    refusals.push(`The cited proof settled "${proof.outcome}", not "proven".`);
  }
  if (proof) {
    for (const gate of REQUIRED_GATES) {
      const value = proof[gate.field];
      // `!== true` rather than `=== false`: a null gate was never reached, and treating "we did not
      // find out" as a pass is the single most expensive mistake this function could make.
      if (value !== true) refusals.push(`${gate.label} is ${value === null ? "not obtained" : "false"}.`);
    }
  }
  if (proof && proof.oeg2bNoopStable !== true) {
    residualRisks.push(
      "OEG-2b (a no-op dispatch leaves cardVersion unchanged) was not obtained. It requires a write, "
        + "so it is unavailable on production by construction, and the capability model has no way to "
        + "dispatch zero edits. Recorded, not waived.",
    );
  }

  // ── Document shape ────────────────────────────────────────────────────────────────────────────
  // A proof is evidence for the environment that produced it. Promoting a proof taken against a flat
  // document onto an org whose cards come back nested means the serializer paths that were exercised
  // are not the ones that will run.
  if (!org.observedDocumentShape) {
    // ORG-level and answerable with no proof at all, which is exactly why it must be reported even
    // when the proof is missing: it is a second, independent blocker with a different fix.
    refusals.push("This company's document shape has not been recorded — run the config scan first.");
  } else if (proof && !proof.documentShape) {
    refusals.push("The proof did not record a document shape, so it cannot be matched to this company.");
  } else if (proof && proof.documentShape !== org.observedDocumentShape) {
    refusals.push(
      `The proof was taken against a "${proof.documentShape}" document and this company returns `
        + `"${org.observedDocumentShape}".`,
    );
  }

  // ── Vocabulary ────────────────────────────────────────────────────────────────────────────────
  const fields = CARD_CAPABILITY_CONTRACTS[capabilityKey]?.vocabularyFields ?? [];
  for (const field of fields) {
    const verdict = org.scanVerdicts[field];
    if (verdict === "mismatch") {
      // Unconditional. A mis-spelling means the next write of that value is silently ignored, and no
      // proof can make that safe — the H1 incident is precisely a write that "succeeded".
      refusals.push(`The config scan reports "${field}" as a MISMATCH — this account spells it differently.`);
      continue;
    }
    if (verdict === "match") continue;

    /**
     * ── The amendment Step 4.4 forced, and why the written rule could not stand ─────────────────
     * As specified, promotion required every vocabulary field to be `match` in the config scan. That
     * is unsatisfiable for a value a card only passes THROUGH: QA reports `card_lock.status` as
     * `unobserved` because no QA card is in HOLD right now, and standing rule 14 guarantees none
     * stays there. The safest capability in the product, already verified live twice, could never
     * have been promoted.
     *
     * The scan and the prover answer different questions. The scan asks what the fleet looks like AT
     * REST; the prover asks what happens when we write this exact value and read it back — which is
     * strictly stronger evidence, and available for precisely the transient case. So `unobserved`
     * yields to proof evidence, and to nothing else. `mismatch` above still blocks unconditionally,
     * and `unobserved` with no proof observation still blocks.
     */
    const provenSpellings = proof?.vocabulary[field] ?? [];
    if (provenSpellings.length > 0) {
      residualRisks.push(
        `"${field}" is unobserved fleet-wide; accepted on the proof run's own observation `
          + `(${provenSpellings.join(", ")}), which is the only evidence available for a value a card `
          + "passes through rather than rests in.",
      );
      continue;
    }
    refusals.push(
      `The config scan reports "${field}" as UNOBSERVED and the proof run did not observe it either. `
        + "No evidence is not evidence.",
    );
  }

  return { allowed: refusals.length === 0, refusals, residualRisks };
}
