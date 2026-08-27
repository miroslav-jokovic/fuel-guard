import { Router } from "express";
import { z } from "zod";
import { getAppLocals } from "../../../lib/appLocals.js";
import { assertEchoFidelity, driftAgainstExpected, serializeSetCardRequest, type EchoDiff } from "../lib/efsCardEcho.js";
import { VOLATILE_FIELDS, documentShape, type CardDocument } from "../lib/efsCardXml.js";
import { egressAddress } from "../../../lib/egressAddress.js";
import { getCardSummaries, getCardV2 } from "../lib/efsCardOps.js";
import { setCardV2 } from "../lib/efsCardWrite.js";
import { efsLogin } from "../lib/efsSoapSession.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { writeAudit } from "../../../lib/audit.js";
import { credentialIdentityHash, efsEndpointHost } from "../services/efsSoapCredentialIdentity.js";
import { requireAuth, requireOrg, requireRole } from "../../../middleware/auth.js";
import { requireFreshAuth } from "../../../middleware/requireFreshAuth.js";
import { resolveProbeCredentials } from "./probeGuards.js";
import { runRealChangeSteps, runStep, type ProbeStep } from "./writeProbeRealChange.js";
import { judge, type Entitlement } from "./writeProbeJudge.js";

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

      const creds = await resolveProbeCredentials(admin, env, orgId, cardNumber);

      // Read BEFORE anything is written, for two reasons: the response must report what the org
      // actually HOLDS rather than what this run guessed, and `judge()` needs it to stop telling an
      // already-entitled org that its write access is "still UNPROVEN" after a read-only run.
      const { data: priorRow } = await admin
        .from("efs_card_control_settings")
        .select("write_entitlement")
        .eq("org_id", orgId)
        .maybeSingle();
      const priorEntitlement =
        (priorRow as { write_entitlement?: Entitlement } | null)?.write_entitlement ?? "unknown";

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

      const { entitlement: judged, recommendation, verdict } = judge(steps, readOnly, priorEntitlement);

      /**
       * ── Step 2.7: a READ-ONLY run must not touch `write_entitlement` ────────────────────────────
       *
       * This upsert used to write `judged` unconditionally, and `judge()` returns `unknown` for every
       * read-only run BY CONSTRUCTION: `denied` can only come from a permission refusal at step 5 or
       * step 7, and `confirmed` requires step 8 — none of which run when `readOnly` is true. So a
       * read-only verdict is not a finding about write access at all. It is the ABSENCE of evidence,
       * and storing it converted "we did not look" into "we looked and found nothing".
       *
       * The cost was concrete: running the harmless diagnostic against an org that was already
       * `confirmed` downgraded it to `unknown` and stopped every card action there until somebody ran
       * the full ten-step probe against a disposable card. The read-only path is the one an operator
       * reaches for precisely BECAUSE it is safe, so the trap was laid on the cautious route.
       *
       * Omitting the key from the payload is what leaves it alone: PostgREST's upsert sets only the
       * columns it is given, so an existing row keeps its value and a brand-new row falls to the
       * column default of `unknown` — which is the right answer for an org whose only probe was
       * read-only.
       */
      const writesEntitlement = !readOnly;

      /**
       * The identity trio is observed on EVERY run, including read-only, and is what Step 2.6's
       * binding needs — so a read-only re-probe is now the cheap way to rebind a credential without
       * touching a card. `probed_document_shape` is the exception: it is only KNOWN when step 3
       * actually returned a document, and writing null over a previously recorded shape would erase
       * a fact this probe simply failed to re-observe. Same rule as the entitlement, one column over.
       */
      const observedShape = before ? documentShape(before) : null;
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
        documentShape: observedShape,
        egressIp,
        // What THIS run was able to conclude about write access, kept distinct from what the org
        // holds. On a read-only run these differ on purpose and the difference is the whole point.
        judgedEntitlement: judged,
        entitlementWritten: writesEntitlement,
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
          ...(writesEntitlement ? { write_entitlement: judged } : {}),
          probed_endpoint_host: efsEndpointHost(creds.endpointUrl),
          probed_identity_hash: credentialIdentityHash(env, creds),
          ...(observedShape !== null ? { probed_document_shape: observedShape } : {}),
          probe_result: probeResult,
          probed_at: new Date().toISOString(),
          probed_by: req.auth!.userId,
        }, { onConflict: "org_id" });

      // What the gate will read after this run: this run's verdict when it wrote one, otherwise
      // whatever was already there.
      const entitlement: Entitlement = writesEntitlement ? judged : priorEntitlement;

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "integration.efs_soap.card_control_probed",
        entity: "efs_card_control_settings",
        meta: {
          environment: creds.environment,
          endpointHost: efsEndpointHost(creds.endpointUrl),
          readOnly,
          cardLast4: last4, // never the PAN
          entitlement,
          // An auditor asking "did this run change what the org may do?" must not have to infer it
          // from `readOnly`. Both facts, named, in the row that outlives the operator's memory.
          judgedEntitlement: judged,
          entitlementWritten: writesEntitlement,
          entitlementBefore: priorEntitlement,
          recommendation,
          verdict,
          steps: steps.map((s) => ({ step: s.step, name: s.name, ok: s.ok, errorCode: s.errorCode ?? null })),
        },
      });

      res.json({
        environment: creds.environment,
        readOnly,
        /** What the capability gate will read from now on — the stored value, not this run's guess. */
        entitlement,
        /**
         * What THIS run could conclude. On a full run it equals `entitlement`; on a read-only run it
         * is always `unknown`, because no write was attempted. Reported separately so the operator
         * can see that a read-only probe proved nothing about write access WITHOUT being told their
         * org just lost its entitlement — which is what this endpoint used to both say and do.
         */
        judgedEntitlement: judged,
        /** False on every read-only run: `write_entitlement` was left exactly as it was. */
        entitlementWritten: writesEntitlement,
        recommendation,
        verdict,
        steps,
        documentShape: observedShape,
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
