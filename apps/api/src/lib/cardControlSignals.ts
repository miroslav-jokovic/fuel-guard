import * as Sentry from "@sentry/node";

/**
 * The operational signals card control emits, and the severity each one carries (Step 5.1).
 *
 * ── Why Sentry and not a metrics stack ──────────────────────────────────────────────────────────
 * Sentry is already initialised, already scrubbed of PII (`instrument.ts` + `lib/sentryScrub.ts`),
 * already tagged with org and release, and already the thing anyone would look at after an incident.
 * Adding a second telemetry system to carry six signals would mean a second place to look, a second
 * thing to keep configured, and a second thing that can be silently off — and standing rule 5 says
 * do not reimplement what exists.
 *
 * Every signal ALSO writes one structured console line. Sentry is a no-op unless `SENTRY_DSN` is set,
 * which is true in local, dev, test and CI runs, and a signal that exists only when a DSN happens to
 * be configured is one nobody can verify. The console line is what makes these observable in Railway
 * logs on a host with no DSN, and what the QA drills in `docs/29-EFS-INCIDENT-RUNBOOK.md` grep for.
 *
 * ── One function per signal, not one generic emit() ─────────────────────────────────────────────
 * The severity of each signal is a decision, and burying it in a `level` argument at 40 call sites
 * is how it gets made differently in each of them. Here it is made once, next to the reason.
 *
 * ── PII ─────────────────────────────────────────────────────────────────────────────────────────
 * Org ids, capability keys, intents and counts only. No card numbers, no PANs, not even a masked
 * last four: these payloads leave the process, and `docs/22` B-series rules say a card is referenced
 * by `efs_cards.id` everywhere it is referenced at all.
 */

/** What a settled mutation counted as. `sent` is the honest "we could not verify" — see 0177. */
export type CardMutationSignalOutcome = "succeeded" | "failed" | "drift_detected" | "sent" | "partial";

type Level = "info" | "warning" | "error" | "fatal";

interface SignalFields {
  [key: string]: string | number | boolean | null;
}

/**
 * The one place a signal actually leaves. Sentry carries the alertable copy; the console line makes
 * the same fact visible without a DSN. `signal` is a tag on both so an alert rule and a log filter
 * can be written against the same string.
 */
function emit(signal: string, level: Level, message: string, fields: SignalFields): void {
  const line = `[card-control-signal] ${signal} ${JSON.stringify(fields)}`;
  if (level === "error" || level === "fatal") console.error(line);
  else if (level === "warning") console.warn(line);
  else console.info(line);

  Sentry.captureMessage(message, {
    level,
    tags: { signal, ...tagsOf(fields) },
    extra: fields,
  });
}

/** Sentry tags must be scalars and are the only thing alert rules can group by. */
function tagsOf(fields: SignalFields): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const key of ["orgId", "capability", "intent", "outcome", "state"]) {
    const value = fields[key];
    if (value !== undefined && value !== null) tags[key] = String(value);
  }
  return tags;
}

/**
 * A card mutation reached a terminal state.
 *
 * Severity follows what an operator has to DO about it, which is not the same as how bad it sounds:
 *   succeeded       info    — the volume signal, and the denominator for every rate
 *   failed          warning — the write did not land; the card is as it was, and that is recoverable
 *   drift_detected  warning — something moved that we did not touch; EFS won and the mirror caught up
 *   partial         error   — a sequence stopped midway, so the card is in neither state anyone chose
 *   sent            error   — UNVERIFIED. We do not know what the card looks like. This is the worst
 *                             of the five and the easiest to mistake for the mildest, because the
 *                             request did not error: nothing is known, and a human has to go and look
 */
export function signalCardMutationSettled(fields: {
  orgId: string;
  intent: string;
  capability: string | null;
  outcome: CardMutationSignalOutcome;
}): void {
  const level: Level =
    fields.outcome === "succeeded" ? "info"
      : fields.outcome === "sent" || fields.outcome === "partial" ? "error"
        : "warning";
  emit(
    "card_mutation_settled",
    level,
    `card mutation ${fields.intent} settled ${fields.outcome}`,
    { ...fields },
  );
}

/**
 * The echo guard refused to send: we could not re-parse our own request.
 *
 * `fatal`, unconditionally, and the step says why — this count "must be identically zero, so any
 * occurrence pages". It is OUR serializer bug rather than the vendor's, it is caught before anything
 * reaches EFS, and a single occurrence means the round-trip fidelity the whole write path is built on
 * has stopped holding. There is no rate here worth tracking; the only acceptable number is none.
 */
export function signalEchoUnfaithful(fields: {
  orgId: string;
  capability: string | null;
  detail: string;
}): void {
  emit("echo_unfaithful", "fatal", "echo guard refused to send a request it could not re-parse", { ...fields });
}

/**
 * The EFS login breaker opened: the account has stopped accepting us and we have stopped asking.
 *
 * `error`. The fuel feed and every card write are paused for the whole window, and the fix is
 * usually outside this system — a rotated password, a locked account, an expired certificate.
 */
export function signalEfsBreakerOpened(fields: {
  orgId: string;
  reason: string;
  openUntilIso: string;
}): void {
  emit("efs_breaker_opened", "error", "EFS login breaker opened", { ...fields });
}

/**
 * A capability's promotion state changed.
 *
 * `warning` either way, and deliberately not `info` for a suspension. Both directions are worth
 * waking up for: enabling is the act that lets code touch a customer's fuel cards, and suspending
 * means someone believed it was doing harm. A promotion nobody noticed is the thing this exists to
 * make impossible.
 */
export function signalPromotionStateChanged(fields: {
  orgId: string;
  capability: string;
  state: string;
  actorId: string;
  environment: string;
  reason: string;
}): void {
  emit("promotion_state_changed", "warning", `capability ${fields.capability} is now ${fields.state}`, { ...fields });
}

/**
 * The mirror sweep finished.
 *
 * `warning` when the sweep had failures OR when any card is left with no `detail_synced_at`, because
 * a card with no detail is a card the product cannot answer questions about — the badge renders the
 * mirror, and a mirror row only says what EFS said at `detail_synced_at`. `info` on a clean sweep,
 * which is also the heartbeat: the absence of this signal is itself the alert, since a scheduler that
 * stopped running produces silence rather than an error.
 */
export function signalMirrorSweepCompleted(fields: {
  orgId: string;
  cardsSeen: number;
  detailed: number;
  linked: number;
  tombstoned: number;
  failed: number;
  cardsWithoutDetail: number;
}): void {
  const clean = fields.failed === 0 && fields.cardsWithoutDetail === 0;
  emit(
    "mirror_sweep_completed",
    clean ? "info" : "warning",
    `mirror sweep finished: ${fields.cardsSeen} seen, ${fields.failed} failed, ${fields.cardsWithoutDetail} without detail`,
    { ...fields },
  );
}
