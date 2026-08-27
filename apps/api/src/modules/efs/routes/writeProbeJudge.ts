import type { ProbeStep } from "./writeProbeRealChange.js";

/**
 * The verdict half of the entitlement probe — `writeProbe.ts` runs the ten steps, this decides what
 * they mean.
 *
 * Split out 2026-08-15 when Step 2.7's changes took the route past the 500-line budget. The seam was
 * already there: everything here is a PURE function of the step results, with no Express, no
 * Supabase and no vendor client, which is why it is also the half worth testing directly. Splitting
 * was chosen over a `check-file-size` waiver deliberately — a waiver would have pinned the route at
 * its current size and made the next addition somebody else's problem.
 */

export type Entitlement = "unknown" | "confirmed" | "denied";

export interface ProbeVerdict {
  entitlement: Entitlement;
  recommendation: string;
  verdict: string;
}

/**
 * Turn six step results into the one field that gates the product.
 *
 * The three outcomes are deliberately NOT symmetric:
 *   • all six pass                     → `confirmed`. Phase B may be switched on for a pilot org.
 *   • step 5 refused on permissions    → `denied`. Go to WEX naming `setCardV2` and
 *                                        `setCardRefreshingLimits` explicitly. Phase A stands alone.
 *   • step 4 or 6 failed               → `unknown` + `fix_echo`. OUR bug. Add the response as a
 *                                        fixture, fix the serializer, re-probe. NEVER proceed.
 *
 * A read-only run can never return `confirmed`: it did not attempt a write, and an entitlement nobody
 * tested is exactly the assumption this whole gate exists to refuse.
 *
 * ── What the caller does with `unknown` from a read-only run (Step 2.7) ──────────────────────────
 * NOTHING. This function judges the RUN; it does not decide what the org holds. Because `denied`
 * needs a permission refusal at step 5 or 7 and `confirmed` needs step 8, a read-only run's verdict
 * is structurally always `unknown` — the absence of evidence, not evidence of absence. The caller
 * therefore leaves `write_entitlement` untouched on a read-only run. `priorEntitlement` is passed in
 * only so the read-only VERDICT TEXT can stop telling an org that already proved its write access
 * that the access is "still unproven".
 */
export function judge(steps: ProbeStep[], readOnly: boolean, priorEntitlement: Entitlement = "unknown"): {
  entitlement: Entitlement;
  recommendation: string;
  verdict: string;
} {
  const at = (n: number) => steps.find((s) => s.step === n);
  const failed = (n: number) => at(n) !== undefined && at(n)!.ok === false;

  if (failed(1)) {
    return {
      entitlement: "unknown",
      recommendation: "fix_credentials",
      verdict: "Login failed — nothing below is meaningful. Fix credentials or connectivity first.",
    };
  }
  if (failed(2) || failed(3)) {
    return {
      entitlement: "unknown",
      recommendation: "fix_read_access",
      verdict: "The read half is not working on this account, so the write half cannot be judged. Run the read diagnostic (POST /api/fuel-cards/diagnose) first.",
    };
  }
  if (failed(4)) {
    return {
      entitlement: "unknown",
      recommendation: "fix_echo",
      verdict:
        "The zero-edit echo does NOT faithfully reproduce this account's own card XML. This is our bug, not WEX's. " +
        "Capture the getCardv2 response as a fixture in apps/api/src/lib/__fixtures__/efs/, fix the serializer, and re-probe. Do not enable writes.",
    };
  }
  if (readOnly) {
    return {
      entitlement: "unknown",
      // An org that already proved write access does not need to prove it again to have run a
      // read-only check, and telling it to "re-run with readOnly=false" would send an operator to
      // write to a real card for no reason. What a read-only run DOES refresh is the credential
      // identity binding, which is the whole of Step 2.6 and needs no write at all.
      recommendation: priorEntitlement === "confirmed" ? "no_action" : "run_write_half",
      verdict:
        priorEntitlement === "confirmed"
          ? "The echo is faithful against real vendor XML, and the credential identity binding has been "
            + "refreshed. This run attempted no write, so it proves nothing new about write access — and "
            + "it has changed nothing: write_entitlement remains 'confirmed' from the run that earned it."
          : "The echo is faithful against real vendor XML — the half that needs no write permission passed. "
            + "Write entitlement is still UNPROVEN: re-run with readOnly=false against a card WEX has confirmed is disposable.",
    };
  }
  if (failed(5)) {
    const code = at(5)?.errorCode;
    const permissionRefusal = code === "not_allowed" || code === "auth";
    return {
      entitlement: permissionRefusal ? "denied" : "unknown",
      recommendation: permissionRefusal ? "ask_wex_for_write_entitlement" : "investigate_write_failure",
      verdict: permissionRefusal
        ? "EFS refused setCardV2 for this account. Ask WEX to enable it, naming setCardV2 and setCardRefreshingLimits explicitly. Phase A (reads) is unaffected and stays live."
        : "setCardV2 failed for a reason that is not a permission refusal — see the step error. Do not enable writes until it is understood.",
    };
  }
  if (failed(6)) {
    return {
      entitlement: "unknown",
      recommendation: "fix_echo",
      verdict:
        "THE GATE FAILED. setCardV2 SUCCEEDED and the card CHANGED — a no-op echo must leave cardVersion identical. " +
        "Our request is silently altering cards. Capture the response as a fixture, fix the serializer, re-probe. Do not enable writes.",
    };
  }
  if (failed(7)) {
    const code = at(7)?.errorCode;
    const permissionRefusal = code === "not_allowed" || code === "auth";
    return {
      entitlement: permissionRefusal ? "denied" : "unknown",
      recommendation: permissionRefusal ? "ask_wex_for_write_entitlement" : "investigate_real_change_failure",
      verdict: permissionRefusal
        ? "EFS refused the REAL change even though the no-op echo was accepted. Ask WEX to enable setCardV2 mutations for this account."
        : "The real-change write failed for a reason that is not a permission refusal — see step 7. Do not enable writes.",
    };
  }
  if (failed(8)) {
    return {
      entitlement: "unknown",
      recommendation: "no_change_investigate",
      verdict:
        "EFS ACCEPTED the real change and NEVER APPLIED it — the exact live no_change failure (audit Part 1). " +
        "Run the Phase 0 experiments (docs/plans/EFS-PHASE0-EXPERIMENTS-RUNBOOK.md): casing, wrapper, originalStatus, setCard v1 — then WEX. Do not enable writes.",
    };
  }
  if (failed(9) || failed(10)) {
    return {
      entitlement: "unknown",
      recommendation: "restore_card_manually",
      verdict:
        "The change APPLIED but the revert did not complete — the card may still be in the changed status. " +
        "Restore it in the WEX portal, then re-probe. Apply works; do not enable writes until a full apply-and-revert cycle is clean.",
    };
  }
  const applied = at(8) !== undefined;
  if (!applied) {
    // Six proofs green but the real-change half never ran (it requires all six first). Without it,
    // "EFS applies our edits" is still unproven — the exact gap the 2026-08-12 incident exposed.
    return {
      entitlement: "unknown",
      recommendation: "run_real_change_half",
      verdict:
        "The no-op half passed, but the REAL-CHANGE half (steps 7–10) did not run. write_entitlement stays unproven " +
        "until one reversible edit demonstrably applies and reverts. Re-run readOnly=false.",
    };
  }
  return {
    entitlement: "confirmed",
    recommendation: "enable_for_pilot_org",
    verdict:
      "All ten proofs passed: the account may write, a no-op echo left the card byte-identical, and a real edit " +
      "applied and reverted with measured latency. Phase B may be enabled for ONE pilot org. Watch the mutation ledger for a week before widening.",
  };
}
