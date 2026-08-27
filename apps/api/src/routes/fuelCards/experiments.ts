import { Router } from "express";
import { efsStatusEquals, matchStatusCasing } from "@silvicom/shared";
import { getAppLocals } from "../../lib/appLocals.js";
import { writeAudit } from "../../lib/audit.js";
import {
  experimentEdits,
  isExperimentStatus,
  transformForVariant,
  variantOperation,
} from "../../lib/efsCardExperiments.js";
import { assertEchoFidelity, driftAgainstExpected, serializeSetCardRequest } from "../../lib/efsCardEcho.js";
import { VOLATILE_FIELDS, documentShape, redactCardXml, type CardDocument } from "../../lib/efsCardXml.js";
import { callCardOp, getCardV2 } from "../../lib/efsCardOps.js";
import { classifySetCardResponse, deleteOverrideOp, isDecline } from "../../lib/efsCardWrite.js";
import { overrideClearEdits, overrideGrantEdits } from "../../services/efsCardEdits.js";
import { loadCardNumber } from "../../services/efsCardMirror.js";
import { EfsSoapError } from "../../lib/efsSoapSession.js";
import { apiError, asyncHandler } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { requireAuth, requireOrg, requireRole } from "../../middleware/auth.js";
import { requireFreshAuth } from "../../middleware/requireFreshAuth.js";
import { resolveProbeCredentials } from "./probeGuards.js";

/**
 * Phase 0 experiment endpoint — the instrument for diagnosing "EFS accepted the request but the
 * card is unchanged" (ledger row 2026-08-12 00:23, card ••••7671).
 *
 * One endpoint, four experiments:
 *
 *   read_state      — E1. A fresh getCardv2, reporting the STATUS CASING this account actually
 *                     returns and whether the earlier lock landed after all (hypothesis H2, apply
 *                     latency). Read-only; no confirmation required.
 *   set_status      — E2–E5. One real setCard write in a chosen VARIANT (see
 *                     lib/efsCardExperiments.ts), verified by re-reads at 0s / +3s / +8s so a slow
 *                     vendor-side apply is seen as "landed late" rather than misdiagnosed as
 *                     "not applied".
 *   set_override    — D1a. Grant a 1-use override via the production recipe, so the delete
 *                     experiment has a real exception to remove. (Phase 0 found: writes must match
 *                     the account's own status casing — H1; overrides are numeric and unaffected.)
 *   delete_override — D1b. The dedicated `deleteOverride` op (guide p27). Answers BOTH D1 probe
 *                     questions in one dispatch: is this account entitled to the op, and what does
 *                     EFS actually set the three override fields to afterwards (0? nil? absent?) —
 *                     the observation production's landed-verifier is built from (fix plan D1).
 *   clear_override  — the production FALLBACK (three-field echo clear) as an experiment: the
 *                     self-service cleanup when delete_override is unentitled, and the baseline
 *                     the dedicated op's behaviour is compared against.
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


import {
  VERIFY_DELAYS_MS,
  experimentSchema,
  readLimits,
  sleep,
  type OverrideReading,
  type VerifyReading,
} from "./experimentShapes.js";

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
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;

      /**
       * Exactly one of `cardNumber` / `efsCardId`, and the uuid is resolved HERE — org-scoped.
       *
       * `loadCardNumber` is the same unseal the card-refresh route uses, and it is scoped to the
       * caller's org, so a uuid from another tenant resolves to nothing rather than to a card. That
       * is the property that makes accepting an id safe at all, and it is why the resolution is not
       * done in the CLI: the browser and the terminal never hold a PAN they were not already given.
       */
      if ((input.cardNumber === undefined) === (input.efsCardId === undefined)) {
        res.status(400).json(apiError(
          "invalid_request",
          "Name the card by exactly one of `cardNumber` or `efsCardId`.",
        ));
        return;
      }
      const cardNumber = input.efsCardId
        ? await loadCardNumber(admin, env, orgId, input.efsCardId)
        : input.cardNumber!;
      if (!cardNumber) {
        res.status(404).json(apiError("not_found", "That card is not in this company."));
        return;
      }
      const last4 = cardNumber.slice(-4);
      const creds = await resolveProbeCredentials(admin, env, orgId, cardNumber);

      // ── E1: read-only state check ─────────────────────────────────────────────────────────────
      if (input.experiment === "read_state") {
        const doc = await getCardV2(env, creds, cardNumber, {
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
      // ── D1a: grant (or echo-clear) an override through the standard echo ──────────────────────
      // One block for both: they are the same dispatch with a different recipe, and the recipes are
      // production's own (services/efsCardEdits.ts) — the experiment must exercise the exact
      // documents a real operator produces, or it tests a state nobody hits.
      if (input.experiment === "set_override" || input.experiment === "clear_override") {
        const before = await getCardV2(env, creds, cardNumber, {
          priority: "interactive", timeoutMs: env.EFS_SOAP_INTERACTIVE_TIMEOUT_MS,
        });
        const grant = input.experiment === "set_override" ? input : null;
        const edits = grant
          ? overrideGrantEdits(
              before, grant.uses,
              grant.locationId !== undefined
                ? { kind: "location" as const, locationId: grant.locationId }
                : { kind: "all" as const },
              /**
               * Empty by default — a probe does not delete a card's limits unless it was asked to.
               * Step 10.4 asks on purpose, on a named QA card, and `limitsBefore` in the response is
               * the recovery record if the vendor turns out not to restore them.
               */
              grant?.limits ?? [],
            )
          : overrideClearEdits();
        /** What the trio's count should read once the write lands. */
        const wantedUses = grant?.uses ?? 0;

        let requestXmlRedacted = "";
        let writeError: EfsSoapError | null = null;
        let responseXmlRedacted: string | null = null;
        const writeStarted = Date.now();
        try {
          const xml = await callCardOp(
            env, creds, "setCardv2",
            (session) => {
              const { xml: body } = serializeSetCardRequest(
                before, { clientId: session.clientId, cardNumber: cardNumber }, edits,
              );
              assertEchoFidelity(before, body, edits);
              requestXmlRedacted = redactCardXml(body);
              return body;
            },
            { priority: "interactive", timeoutMs: env.EFS_SOAP_INTERACTIVE_TIMEOUT_MS, retry: false },
          );
          const classified = classifySetCardResponse(xml);
          responseXmlRedacted = redactCardXml(xml);
          if (isDecline(classified.resultText)) {
            writeError = new EfsSoapError(`EFS refused the card change: ${classified.resultText}`, "declined");
          }
        } catch (error) {
          if (!(error instanceof EfsSoapError)) throw error;
          writeError = error;
        }
        const writeMs = Date.now() - writeStarted;

        const readings: OverrideReading[] = [];
        let after: CardDocument | null = null;
        if (writeError?.code !== "echo_unfaithful") {
          for (const delay of VERIFY_DELAYS_MS) {
            if (delay > 0) await sleep(delay);
            const read = await getCardV2(env, creds, cardNumber, {
              priority: "interactive", timeoutMs: env.EFS_SOAP_INTERACTIVE_TIMEOUT_MS,
            });
            after = read;
            const landed = (read.card.overrideUses ?? 0) === wantedUses;
            readings.push({
              atMsAfterWrite: Date.now() - writeStarted - writeMs,
              version: read.version,
              overrideUses: read.card.overrideUses,
              overrideAllLocations: read.card.overrideAllLocations,
              locationOverrideId: read.card.locationOverrideId,
              landed,
              limits: readLimits(read.card),
            });
            if (landed) break;
          }
        }
        const landed = readings.some((r) => r.landed);

        await writeAudit(admin, {
          orgId, actorId: req.auth!.userId,
          action: "integration.efs_soap.card_experiment",
          entity: "efs_soap_credentials", entityId: orgId,
          meta: {
            experiment: input.experiment, uses: wantedUses, locationId: grant?.locationId ?? null,
            cardLast4: last4, landed, writeErrorCode: writeError?.code ?? null,
            versionBefore: before.version, versionAfter: after?.version ?? null,
          },
        });

        res.json({
          experiment: input.experiment,
          cardLast4: last4,
          uses: wantedUses,
          locationId: grant?.locationId ?? null,
          before: {
            version: before.version,
            overrideUses: before.card.overrideUses,
            overrideAllLocations: before.card.overrideAllLocations,
            locationOverrideId: before.card.locationOverrideId,
            /**
             * ⚠ Step 10.4's RECOVERY RECORD, and the reason this endpoint is safe to point at a card
             * that has limits worth keeping. p194's product recipe deletes them; nothing promises
             * they come back. If the answer turns out to be "they do not", these are the exact
             * records to put back by hand — so they are captured BEFORE the write, not inferred
             * afterwards from a card that no longer has them.
             */
            limits: readLimits(before.card),
          },
          writeMs,
          writeErrorCode: writeError?.code ?? null,
          writeErrorMessage: writeError ? redactCardXml(writeError.message).slice(0, 300) : null,
          readings,
          landed,
          changedPaths: (after === null ? [] : driftAgainstExpected(before, edits, after, VOLATILE_FIELDS))
            .slice(0, 20).map((d) => d.path),
          requestXmlRedacted,
          responseXmlRedacted,
        });
        return;
      }

      // ── D1b: the dedicated deleteOverride op — entitlement AND post-state in one dispatch ─────
      if (input.experiment === "delete_override") {
        const before = await getCardV2(env, creds, cardNumber, {
          priority: "interactive", timeoutMs: env.EFS_SOAP_INTERACTIVE_TIMEOUT_MS,
        });

        let requestXmlRedacted: string | null = null;
        let responseXmlRedacted: string | null = null;
        let responseShape: string | null = null;
        let resultText: string | null = null;
        let writeError: EfsSoapError | null = null;
        const writeStarted = Date.now();
        try {
          const result = await deleteOverrideOp(env, creds, cardNumber, {
            priority: "interactive", timeoutMs: env.EFS_SOAP_INTERACTIVE_TIMEOUT_MS,
          });
          requestXmlRedacted = result.requestXmlRedacted;
          responseXmlRedacted = result.responseXmlRedacted;
          responseShape = result.shape;
          resultText = result.resultText;
        } catch (error) {
          // `not_allowed`/`auth` here IS a finding: the account is not provisioned for the op, the
          // flag stays off, and the question goes on the E6 WEX ticket (fix plan D1 step 1).
          if (!(error instanceof EfsSoapError)) throw error;
          writeError = error;
        }
        const writeMs = Date.now() - writeStarted;

        const readings: OverrideReading[] = [];
        let after: CardDocument | null = null;
        for (const delay of VERIFY_DELAYS_MS) {
          if (delay > 0) await sleep(delay);
          const read = await getCardV2(env, creds, cardNumber, {
            priority: "interactive", timeoutMs: env.EFS_SOAP_INTERACTIVE_TIMEOUT_MS,
          });
          after = read;
          // The production predicate's question, asked the production way: no uses remain.
          const landed = (read.card.overrideUses ?? 0) === 0;
          readings.push({
            atMsAfterWrite: Date.now() - writeStarted - writeMs,
            version: read.version,
            overrideUses: read.card.overrideUses,
            overrideAllLocations: read.card.overrideAllLocations,
            locationOverrideId: read.card.locationOverrideId,
            landed,
            limits: readLimits(read.card),
          });
          if (landed) break;
        }
        const landed = readings.some((r) => r.landed);

        await writeAudit(admin, {
          orgId, actorId: req.auth!.userId,
          action: "integration.efs_soap.card_experiment",
          entity: "efs_soap_credentials", entityId: orgId,
          meta: {
            experiment: "delete_override", cardLast4: last4, landed,
            writeErrorCode: writeError?.code ?? null,
            versionBefore: before.version, versionAfter: after?.version ?? null,
          },
        });

        res.json({
          experiment: "delete_override",
          cardLast4: last4,
          before: {
            version: before.version,
            overrideUses: before.card.overrideUses,
            overrideAllLocations: before.card.overrideAllLocations,
            locationOverrideId: before.card.locationOverrideId,
            /**
             * ⚠ Step 10.4's RECOVERY RECORD, and the reason this endpoint is safe to point at a card
             * that has limits worth keeping. p194's product recipe deletes them; nothing promises
             * they come back. If the answer turns out to be "they do not", these are the exact
             * records to put back by hand — so they are captured BEFORE the write, not inferred
             * afterwards from a card that no longer has them.
             */
            limits: readLimits(before.card),
          },
          writeMs,
          writeErrorCode: writeError?.code ?? null,
          writeErrorMessage: writeError ? redactCardXml(writeError.message).slice(0, 300) : null,
          responseShape,
          resultText,
          readings,
          landed,
          /** With no edits expected, every changed path is the op's observed footprint — the data. */
          changedPaths: (after === null ? [] : driftAgainstExpected(before, [], after, VOLATILE_FIELDS))
            .slice(0, 20).map((d) => d.path),
          /** The full post-state document, redacted — 0 vs nil vs absent is legible only here. */
          afterDocument: after?.redactedXml ?? null,
          requestXmlRedacted,
          responseXmlRedacted,
        });
        return;
      }

      if (!isExperimentStatus(input.status) || (input.setOriginalStatus !== undefined && !isExperimentStatus(input.setOriginalStatus))) {
        res.status(400).json(apiError("invalid_request", "Experiments may only write Active, Inactive or Hold (any casing)."));
        return;
      }

      const before = await getCardV2(env, creds, cardNumber, {
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

      // The bytes that actually go on the wire, and the only value reported as `statusSent` below:
      // a transcript that echoed the REQUESTED status while sending a different one would be worse
      // than no transcript.
      const statusSent = input.matchAccountCasing
        ? matchStatusCasing(before.card.status, input.status)
        : input.status;
      const edits = [
        ...experimentEdits({
          statusValue: statusSent,
          originalStatusValue: input.setOriginalStatus,
        }),
        // `overrideClearEdits()` itself, which is what card_lock appends for `clearException`. A
        // hand-written trio here would be a second definition of "clear an override", and a green
        // result from it would say nothing about the path that actually ships.
        ...(input.clearOverride ? overrideClearEdits() : []),
      ];

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
              before, { clientId: session.clientId, cardNumber: cardNumber }, edits,
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
          const read = await getCardV2(env, creds, cardNumber, {
            priority: "interactive", timeoutMs: env.EFS_SOAP_INTERACTIVE_TIMEOUT_MS,
          });
          after = read;
          const landed = efsStatusEquals(read.card.status, input.status);
          readings.push({
            atMsAfterWrite: Date.now() - writeStarted - writeMs,
            version: read.version,
            status: read.card.status,
            overrideUses: read.card.overrideUses,
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
          statusSent,
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
        statusSent,
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
