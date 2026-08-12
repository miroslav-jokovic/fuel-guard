import { Router } from "express";
import { z } from "zod";
import { efsStatusEquals } from "@fuelguard/shared";
import { getAppLocals } from "../../lib/appLocals.js";
import { writeAudit } from "../../lib/audit.js";
import {
  EXPERIMENT_VARIANTS,
  experimentEdits,
  isExperimentStatus,
  transformForVariant,
  variantOperation,
} from "../../lib/efsCardExperiments.js";
import { assertEchoFidelity, driftAgainstExpected, serializeSetCardRequest } from "../../lib/efsCardEcho.js";
import { VOLATILE_FIELDS, documentShape, redactCardXml, type CardDocument } from "../../lib/efsCardXml.js";
import { callCardOp, getCardV2 } from "../../lib/efsCardOps.js";
import { classifySetCardResponse, isDecline } from "../../lib/efsCardWrite.js";
import { EfsSoapError } from "../../lib/efsSoapSession.js";
import { apiError, asyncHandler } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { requireAuth, requireOrg, requireRole } from "../../middleware/auth.js";
import { requireFreshAuth } from "../../middleware/requireFreshAuth.js";
import { getEfsSoapCredentials } from "../../services/efsSoapCredentials.js";

/**
 * Phase 0 experiment endpoint — the instrument for diagnosing "EFS accepted the request but the
 * card is unchanged" (ledger row 2026-08-12 00:23, card ••••7671).
 *
 * One endpoint, two experiments:
 *
 *   read_state — E1. A fresh getCardv2, reporting the STATUS CASING this account actually returns
 *                and whether the earlier lock landed after all (hypothesis H2, apply latency).
 *                Read-only; no confirmation required.
 *   set_status — E2–E5. One real setCard write in a chosen VARIANT (see lib/efsCardExperiments.ts),
 *                verified by re-reads at 0s / +3s / +8s so a slow vendor-side apply is seen as
 *                "landed late" rather than misdiagnosed as "not applied".
 *
 * ── Safety rails, identical to the write probe's and for the same reasons ────────────────────────
 * admin role · fresh sign-in · `EFS_CARD_CONTROL_PROBE_ENABLED` (staging only, unset afterwards) ·
 * a typed `WRITE <last4>` confirmation for anything that dispatches · statuses allowlisted to
 * Active/Inactive/Hold (`Deleted` is the vendor's hard delete, p128 — unreachable from here) ·
 * every recorded string passes `redactCardXml` · the card number is never persisted.
 *
 * ── What this deliberately does NOT do ───────────────────────────────────────────────────────────
 * No ledger row and no mirror write. These are experiments against a disposable card, not operator
 * mutations: a mutation row would put diagnostic noise in the same table the drawer's history
 * reads, and the mirror must keep reflecting only real reads/writes. The audit log still records
 * every dispatch — experiments are auditable, they are just not card history.
 *
 * Findings land in docs/22-EFS-CARD-CONTROL.md per the Phase 0 acceptance criteria; the runbook is
 * docs/plans/EFS-PHASE0-EXPERIMENTS-RUNBOOK.md.
 */

const experimentSchema = z.discriminatedUnion("experiment", [
  z.object({
    experiment: z.literal("read_state"),
    cardNumber: z.string().trim().regex(/^[0-9]{10,25}$/),
  }),
  z.object({
    experiment: z.literal("set_status"),
    cardNumber: z.string().trim().regex(/^[0-9]{10,25}$/),
    /** Sent VERBATIM — casing is hypothesis H1. Allowlist enforced below with a readable error. */
    status: z.string().trim().min(1),
    variant: z.enum(EXPERIMENT_VARIANTS).default("standard"),
    /** Hypothesis H3. Only meaningful alongside a Hold; the vendor decides what it does with it. */
    setOriginalStatus: z.string().trim().min(1).optional(),
    confirm: z.string().trim(),
  }),
]);

/** Re-read schedule after the write, in ms after the previous read. Three looks, ~8s total: enough
 *  to catch a replication-lagged apply (H2) without turning the endpoint into a poller. */
const VERIFY_DELAYS_MS = [0, 3_000, 5_000] as const;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface VerifyReading {
  atMsAfterWrite: number;
  version: string;
  /** Verbatim vendor casing — the reading IS the data here. */
  status: string | null;
  landed: boolean;
}

export function fuelCardExperimentsRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.post(
    "/experiment",
    requireOrg,
    requireRole("admin"),
    requireFreshAuth(),
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      if (!env.EFS_CARD_CONTROL_PROBE_ENABLED) {
        res.status(403).json(apiError(
          "probe_disabled",
          "Experiments are switched off. Set EFS_CARD_CONTROL_PROBE_ENABLED=true on the staging API, run them, then unset it.",
        ));
        return;
      }

      const parsed = experimentSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json(apiError("invalid_request", parsed.error.issues[0]?.message ?? "Invalid experiment request"));
        return;
      }
      const input = parsed.data;
      const last4 = input.cardNumber.slice(-4);

      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const creds = await getEfsSoapCredentials(admin, env, orgId);
      if (!creds?.enabled) {
        res.status(409).json(apiError("efs_not_configured", "EFS is not connected for this company."));
        return;
      }

      // ── E1: read-only state check ─────────────────────────────────────────────────────────────
      if (input.experiment === "read_state") {
        const doc = await getCardV2(env, creds, input.cardNumber, {
          priority: "interactive", timeoutMs: env.EFS_SOAP_INTERACTIVE_TIMEOUT_MS,
        });
        res.json({
          experiment: "read_state",
          cardLast4: last4,
          version: doc.version,
          /** Verbatim — whether this account says `HOLD` or `Hold` is half of what E1 exists to learn. */
          status: doc.card.status,
          originalStatus: doc.card.originalStatus,
          overrideUses: doc.card.overrideUses,
          overrideAllLocations: doc.card.overrideAllLocations,
          locationOverrideId: doc.card.locationOverrideId,
          documentShape: documentShape(doc),
          document: doc.redactedXml,
        });
        return;
      }

      // ── E2–E5: one variant write, verified by scheduled re-reads ──────────────────────────────
      if (input.confirm.toUpperCase() !== `WRITE ${last4}`) {
        res.status(400).json(apiError(
          "confirmation_required",
          `Type "WRITE ${last4}" to confirm a real card write for this experiment.`,
        ));
        return;
      }
      if (!isExperimentStatus(input.status) || (input.setOriginalStatus !== undefined && !isExperimentStatus(input.setOriginalStatus))) {
        res.status(400).json(apiError("invalid_request", "Experiments may only write Active, Inactive or Hold (any casing)."));
        return;
      }

      const before = await getCardV2(env, creds, input.cardNumber, {
        priority: "interactive", timeoutMs: env.EFS_SOAP_INTERACTIVE_TIMEOUT_MS,
      });
      if (input.variant === "setcard_v1" && before.card.limits.length > 0) {
        // WSCard (v1) has no autoRoll fields, so a v1 echo of a card WITH limits could drop data —
        // the precondition the lib documents, enforced where the card is actually in hand.
        res.status(409).json(apiError(
          "invalid_request",
          "The setcard_v1 variant is only safe on a card with no limits — this card has some.",
        ));
        return;
      }

      const edits = experimentEdits({
        statusValue: input.status,
        originalStatusValue: input.setOriginalStatus,
      });

      let requestXmlRedacted = "";
      let writeError: EfsSoapError | null = null;
      let responseXmlRedacted: string | null = null;
      let responseShape: string | null = null;
      let resultText: string | null = null;

      const writeStarted = Date.now();
      try {
        const xml = await callCardOp(
          env, creds,
          // The operation is decided by the variant; the body callback below builds the matching shape.
          variantOperation(input.variant),
          (session) => {
            const { xml: canonical } = serializeSetCardRequest(
              before, { clientId: session.clientId, cardNumber: input.cardNumber }, edits,
            );
            const { body } = transformForVariant(canonical, input.variant);
            // On the exact bytes about to be sent — the transformed string, not the canonical one.
            assertEchoFidelity(before, body, edits);
            requestXmlRedacted = redactCardXml(body);
            return body;
          },
          { priority: "interactive", timeoutMs: env.EFS_SOAP_INTERACTIVE_TIMEOUT_MS, retry: false },
        );
        const classified = classifySetCardResponse(xml);
        responseShape = classified.shape;
        resultText = classified.resultText;
        responseXmlRedacted = redactCardXml(xml);
        if (isDecline(classified.resultText)) {
          writeError = new EfsSoapError(`EFS refused the card change: ${classified.resultText}`, "declined");
        }
      } catch (error) {
        if (!(error instanceof EfsSoapError)) throw error;
        writeError = error;
      }
      const writeMs = Date.now() - writeStarted;

      // The verifying re-reads. Even after a fault we look once — a timed-out write may have landed,
      // and an experiment that skips verification answers nothing.
      const readings: VerifyReading[] = [];
      let after: CardDocument | null = null;
      if (writeError?.code !== "echo_unfaithful") {
        for (const delay of VERIFY_DELAYS_MS) {
          if (delay > 0) await sleep(delay);
          const read = await getCardV2(env, creds, input.cardNumber, {
            priority: "interactive", timeoutMs: env.EFS_SOAP_INTERACTIVE_TIMEOUT_MS,
          });
          after = read;
          const landed = efsStatusEquals(read.card.status, input.status);
          readings.push({
            atMsAfterWrite: Date.now() - writeStarted - writeMs,
            version: read.version,
            status: read.card.status,
            landed,
          });
          if (landed) break;
        }
      }

      const landed = readings.some((r) => r.landed);
      const changed = after === null ? [] : driftAgainstExpected(before, edits, after, VOLATILE_FIELDS);

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "integration.efs_soap.card_experiment",
        entity: "efs_soap_credentials",
        entityId: orgId,
        meta: {
          experiment: "set_status",
          variant: input.variant,
          statusSent: input.status,
          setOriginalStatus: input.setOriginalStatus ?? null,
          cardLast4: last4, // never the PAN
          landed,
          writeErrorCode: writeError?.code ?? null,
          versionBefore: before.version,
          versionAfter: after?.version ?? null,
        },
      });

      res.json({
        experiment: "set_status",
        variant: input.variant,
        statusSent: input.status,
        setOriginalStatus: input.setOriginalStatus ?? null,
        cardLast4: last4,
        statusBefore: before.card.status,
        versionBefore: before.version,
        documentShape: documentShape(before),
        writeMs,
        writeErrorCode: writeError?.code ?? null,
        writeErrorMessage: writeError ? redactCardXml(writeError.message).slice(0, 300) : null,
        responseShape,
        resultText,
        readings,
        landed,
        /** Paths that differ from "the card we read, plus exactly our edits" — empty on a clean landing. */
        changedPaths: changed.slice(0, 20).map((d) => d.path),
        requestXmlRedacted,
        responseXmlRedacted,
      });
    }),
  );

  return router;
}
