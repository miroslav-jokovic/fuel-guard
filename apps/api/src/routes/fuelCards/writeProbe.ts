import { Router } from "express";
import { z } from "zod";
import { getAppLocals } from "../../lib/appLocals.js";
import { assertEchoFidelity, driftAgainstExpected, serializeSetCardRequest, type EchoDiff } from "../../lib/efsCardEcho.js";
import { VOLATILE_FIELDS, documentShape, type CardDocument } from "../../lib/efsCardXml.js";
import { egressAddress } from "../../lib/egressAddress.js";
import { getCardSummaries, getCardV2 } from "../../lib/efsCardOps.js";
import { setCardV2 } from "../../lib/efsCardWrite.js";
import { efsLogin } from "../../lib/efsSoapSession.js";
import { apiError, asyncHandler } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { writeAudit } from "../../lib/audit.js";
import { requireAuth, requireOrg, requireRole } from "../../middleware/auth.js";
import { requireFreshAuth } from "../../middleware/requireFreshAuth.js";
import { getEfsSoapCredentials } from "../../services/efsSoapCredentials.js";
import { runRealChangeSteps, runStep, type ProbeStep } from "./writeProbeRealChange.js";

/**
 * ★ THE GATE. The one thing that decides whether Phase B may be switched on at all.
 *
 * Ten proofs, ALL required. Steps 1–6 prove the echo is faithful and harmless; steps 7–10 prove EFS
 * actually APPLIES an edit and lets us revert it — the half the 2026-08-12 no_change incident showed
 * was missing (audit P0-1). `confirmed` now requires the full ten.
 *
 *   1. `login` succeeds                     → credentials, TLS and routing are good.
 *   2. `getCardSummariesV2` returns ≥1 card → READ entitlement.
 *   3. `getCardv2` parses into a WsCard     → the document model matches this account's real data.
 *   4. A ZERO-EDIT echo passes `assertEchoFidelity` against WEX-AUTHORED XML.
 *   5. `setCardV2` with that zero-edit echo returns success, not a permission fault → WRITE entitlement.
 *   6. A follow-up `getCardv2` returns the SAME `cardVersion` → the no-op echo changed NOTHING.
 *
 * ── Why step 4 runs even when step 5 is expected to fail ─────────────────────────────────────────
 * The fixture suite proves the parser against XML *we* wrote. This proves it against XML *WEX* wrote,
 * on this account, for a real card — which is the only version of that claim that matters, and it
 * needs no write permission whatsoever. An account with read access only still learns whether its
 * echo would have been faithful.
 *
 * ── Why step 6 is the important one ──────────────────────────────────────────────────────────────
 * `setCardV2` can SUCCEED while our echo has silently stripped an `<infos>` record. EFS will happily
 * accept a well-formed request that deletes a driver assignment and report nothing wrong. So a
 * successful write is not evidence of a correct write — only an unchanged `cardVersion` afterwards is.
 * **If the version moves after a no-op echo, the gate FAILS even though the write succeeded**, the
 * entitlement is recorded as `unknown` with recommendation `fix_echo`, and Phase B does not start.
 *
 * ── The safety rails on the probe itself ─────────────────────────────────────────────────────────
 * Admin only · step-up re-authentication · `EFS_CARD_CONTROL_PROBE_ENABLED` (default false, staging
 * only, unset again afterwards) · an explicit typed confirmation string naming the card's last four,
 * so the write half cannot be reached by clicking a button twice · the card number is NEVER persisted
 * · every recorded string goes through `redactCardXml` first.
 *
 * Run against a card WEX has CONFIRMED is disposable, on QA first
 * (`https://ws.partner.efsllc.com/axis2/services/CardManagementWS/`), and only then against a
 * decommissioned card on production. Archive the redacted result in docs/22-EFS-CARD-CONTROL.md.
 */

const writeProbeSchema = z.object({
  /** The disposable card WEX confirmed. Never persisted, never logged, never audited. */
  cardNumber: z.string().trim().regex(/^[0-9]{10,25}$/),
  /**
   * `WRITE <last4>`, typed by the admin.
   *
   * Not ceremony. This endpoint sends a real `setCardV2` to a real card on a shared production-grade
   * service account; the difference between the read probe and this one is that this one can destroy
   * data. Requiring the operator to type four digits they had to look up means the write half cannot
   * be reached by a stray double-click or a replayed request.
   */
  confirm: z.string().trim(),
  /**
   * Stop after step 4. The honest default for a first run: it proves the echo against real vendor XML
   * and touches nothing. Set false only when WEX has confirmed the card is disposable.
   */
  readOnly: z.boolean().default(true),
  /**
   * The status steps 7–10 write and then revert (audit P0-1). Hold or Inactive in ANY casing —
   * casing travels verbatim because it is itself under test (Phase 0 hypothesis H1: this account
   * stores HOLD, the guide documents Hold, and a case-sensitive service enum would silently drop
   * ours). Active is excluded: the revert step is the only thing that writes the original status.
   */
  realChangeStatus: z.string().trim().regex(/^(hold|inactive)$/i, "realChangeStatus must be Hold or Inactive (any casing)").default("Hold"),
});

type Entitlement = "unknown" | "confirmed" | "denied";

export function fuelCardWriteProbeRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.post(
    "/write-check",
    requireOrg,
    requireRole("admin"),
    // Step-up: this is the single most consequential button in the product.
    requireFreshAuth(),
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;

      if (!env.EFS_CARD_CONTROL_PROBE_ENABLED) {
        res.status(403).json(apiError(
          "probe_disabled",
          "The EFS write check is switched off. Set EFS_CARD_CONTROL_PROBE_ENABLED=true on the staging API, run it, then unset it.",
        ));
        return;
      }

      const parsed = writeProbeSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json(apiError("invalid_request", parsed.error.issues[0]?.message ?? "Invalid probe request"));
        return;
      }
      const { cardNumber, confirm, readOnly, realChangeStatus } = parsed.data;
      const last4 = cardNumber.slice(-4);
      if (!readOnly && confirm.toUpperCase() !== `WRITE ${last4}`) {
        res.status(400).json(apiError(
          "confirmation_required",
          `Type "WRITE ${last4}" to confirm a real setCardV2 against this card.`,
        ));
        return;
      }

      const creds = await getEfsSoapCredentials(admin, env, orgId);
      if (!creds?.enabled) {
        res.status(409).json(apiError("efs_not_configured", "EFS is not connected for this company."));
        return;
      }

      const steps: ProbeStep[] = [];
      // A holder rather than a bare `let`: the document is assigned inside a callback, and TypeScript
      // does not carry a narrowing across that boundary — a plain local would type as `never` at every
      // later use and force non-null assertions that hide a real "step 3 did not run" case.
      const state: {
    doc: CardDocument | null;
    after: CardDocument | null;
    versionAfter: string | null;
    changed: EchoDiff[];
  } = { doc: null, after: null, versionAfter: null, changed: [] };

      steps.push(await runStep(1, "login", async () => {
        await efsLogin(env, creds, "interactive");
        return "session established";
      }));

      if (steps[0]!.ok) {
        steps.push(await runStep(2, "getCardSummariesV2 — read entitlement", async () => {
          const rows = await getCardSummaries(env, creds, { useV2: true, priority: "interactive" });
          if (rows.length === 0) throw new Error("no cards returned — read entitlement not proven");
          return `${rows.length} cards`;
        }));

        steps.push(await runStep(3, "getCardv2 — document model", async () => {
          const fresh = await getCardV2(env, creds, cardNumber, { priority: "interactive" });
          state.doc = fresh;
          // The shape is part of the finding, not decoration. A QA account and a production account
          // are different EFS installations: this account answers `nested:header`, every example in
          // the guide is `flat`, and a proof obtained on one shape does not transfer to the other.
          return `shape=${documentShape(fresh)}, ${fresh.card.infos.length} prompts, `
            + `${fresh.card.limits.length} limits, version ${fresh.version.slice(0, 12)}…`;
        }));
      }

      // Step 4 needs NO write permission and runs regardless of what step 5 will do. Fixtures prove
      // the parser against XML we wrote; this is the only proof against XML WEX wrote.
      const before = state.doc;
      if (before) {
        steps.push(await runStep(4, "zero-edit echo — fidelity against vendor XML", async () => {
          const { xml } = serializeSetCardRequest(before, { clientId: "PROBE", cardNumber }, []);
          assertEchoFidelity(before, xml, []);
          return `${xml.length} bytes, every field accounted for`;
        }));
      }

      const echoOk = steps.find((s) => s.step === 4)?.ok === true;

      if (before && echoOk && !readOnly) {
        steps.push(await runStep(5, "setCardV2 — no-op write", async () => {
          const result = await setCardV2(env, creds, before, cardNumber, [], { priority: "interactive" });
          // The guide does not state the success shape ("no news is good news", p9). Record what this
          // account ACTUALLY returns, so lib/efsCardWrite.ts's classifier is tightened against
          // observed behaviour rather than against a reading of the PDF.
          return `shape=${result.shape} result=${result.resultText ?? "(empty)"}`;
        }));

        if (steps.find((s) => s.step === 5)?.ok) {
          steps.push(await runStep(6, "getCardv2 — cardVersion unchanged", async () => {
            const after = await getCardV2(env, creds, cardNumber, { priority: "interactive" });
            state.after = after;
            state.versionAfter = after.version;
            if (after.version !== before.version) {
              // THE failure this whole endpoint exists to catch. The write succeeded AND changed the
              // card. Anything less specific than an error here would let Phase B ship on a lie.
              //
              // NAME THE FIELDS. "Capture the response as a fixture and fix the serializer" is a task
              // for somebody who already knows which field moved; the operator running this has a
              // browser and a stopwatch. `driftAgainstExpected` with an empty edit list asks exactly
              // the right question — "what differs between the card we read and the card we now
              // hold?" — and it is the same function the reconciler uses, so the two cannot disagree.
              state.changed = driftAgainstExpected(before, [], after, VOLATILE_FIELDS);
              const named = state.changed
                .slice(0, 6)
                .map((d) => `${d.path}: ${d.expected.join("|") || "(absent)"} → ${d.actual.join("|") || "(absent)"}`)
                .join("; ");
              throw new Error(
                `cardVersion MOVED after a no-op echo — our request changed ${state.changed.length} field(s). ` +
                  `Do not enable writes. Changed: ${named}`,
              );
            }
            return "unchanged — the echo is faithful end to end";
          }));
        }
      }

      // ── Steps 7–10: the REAL-CHANGE half (audit P0-1) ─────────────────────────────────────────
      // Only after the no-op half is fully green: a real edit on top of an unfaithful echo or an
      // already-moved card answers nothing and risks the disposable card's state for no evidence.
      let applyLatencyMs: number | null = null;
      let revertLatencyMs: number | null = null;
      if (!readOnly && steps.length === 6 && steps.every((s) => s.ok)) {
        const base = state.after ?? before;
        if (base) {
          const real = await runRealChangeSteps(env, creds, cardNumber, base, realChangeStatus);
          steps.push(...real.steps);
          applyLatencyMs = real.applyLatencyMs;
          revertLatencyMs = real.revertLatencyMs;
          if (real.finalDoc) {
            state.after = real.finalDoc;
            state.versionAfter = real.finalDoc.version;
          }
        }
      }

      const { entitlement, recommendation, verdict } = judge(steps, readOnly);
      // The address EFS saw. On a second environment this is the difference between "WEX has not
      // enabled us" and "WEX allowlisted three IPs and we left from a fourth" — see lib/egressAddress.
      const egressIp = await egressAddress();

      // Persist the verdict, never the card number. The settings row is what the capabilities gate
      // reads, so this write is the act that opens or keeps shut every write route in the product.
      const probeResult = {
        ranAt: new Date().toISOString(),
        environment: creds.environment,
        readOnly,
        cardLast4: last4,
        versionBefore: before?.version ?? null,
        versionAfter: state.versionAfter,
        documentShape: before ? documentShape(before) : null,
        egressIp,
        // Paths only, never values: probe_result is read on every card page load, and a changed
        // field can carry a driver's name. The full before/after go to the operator in the response.
        changedPaths: state.changed.map((d) => d.path),
        // Measured vendor apply latency (step 8 / step 10). THE number that calibrates
        // EFS_CARD_VERIFY_RETRY_MS — see audit P0-2 and the env var's own comment.
        applyLatencyMs,
        revertLatencyMs,
        realChangeStatus: readOnly ? null : realChangeStatus,
        recommendation,
        verdict,
        steps,
      };
      const { error: settingsError } = await admin
        .from("efs_card_control_settings")
        .upsert({
          org_id: orgId,
          write_entitlement: entitlement,
          probe_result: probeResult,
          probed_at: new Date().toISOString(),
          probed_by: req.auth!.userId,
        }, { onConflict: "org_id" });

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "integration.efs_soap.card_control_probed",
        entity: "efs_card_control_settings",
        meta: {
          environment: creds.environment,
          readOnly,
          cardLast4: last4, // never the PAN
          entitlement,
          recommendation,
          verdict,
          steps: steps.map((s) => ({ step: s.step, name: s.name, ok: s.ok, errorCode: s.errorCode ?? null })),
        },
      });

      res.json({
        environment: creds.environment,
        readOnly,
        entitlement,
        recommendation,
        verdict,
        steps,
        documentShape: before ? documentShape(before) : null,
        egressIp,
        /**
         * The card as EFS sent it, PANs masked — returned to the admin who ran the probe, and
         * deliberately NOT persisted.
         *
         * Every hour of the nested-<header> diagnosis was spent getting this string out of the
         * vendor by hand. It is the one artefact that turns "the echo passed" into a fixture
         * somebody can commit, and it is exactly what step 4's failure verdict asks for. Admin-only,
         * same org, already redacted; kept out of `probe_result` so the settings row stays small and
         * so a card document does not sit in a table read on every page load.
         */
        document: before?.redactedXml ?? null,
        /** The card AFTER the write. Present only when step 6 ran — the other half of the diff. */
        documentAfter: state.after?.redactedXml ?? null,
        /**
         * Exactly what moved, path by path, when a no-op echo did not leave the card alone.
         * Empty on a clean run. This is the finding; the two documents above are the evidence.
         */
        changed: state.changed,
        // A failed settings write must not read as a failed probe — the steps above are the finding.
        persisted: !settingsError,
      });
    }),
  );

  return router;
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
 */
function judge(steps: ProbeStep[], readOnly: boolean): {
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
      recommendation: "run_write_half",
      verdict:
        "The echo is faithful against real vendor XML — the half that needs no write permission passed. " +
        "Write entitlement is still UNPROVEN: re-run with readOnly=false against a card WEX has confirmed is disposable.",
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
