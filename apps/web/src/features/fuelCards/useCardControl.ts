import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { computed, type Ref } from "vue";
import type { CardMutationIntent, CardMutationStatus, OverrideScope, PromptInput } from "@fuelguard/shared";
import { apiFetch } from "@/lib/api";

/**
 * Changing a fuel card, from the browser.
 *
 * ── Three rules this file exists to keep ─────────────────────────────────────────────────────────
 *
 * 1. **Every write carries the `expectedVersion` the screen was DRAWN from.** Not a freshly fetched
 *    one — the whole point is to compare what the operator was looking at against what EFS holds now.
 *    Refetching first would defeat the check by construction.
 *
 * 2. **One `Idempotency-Key` per intent per drawer-open.** A double-submitted override is a driver
 *    getting two free tanks, and the browser is where a double submit actually happens: a slow
 *    vendor call, an impatient click, a retried request. The key is minted by the caller (see
 *    `newIdempotencyKey`) and reused across retries of the SAME action.
 *
 * 3. **A 409 is not an error to toast and forget.** `card_state_changed` means the card moved under
 *    the operator; the drawer refetches and shows them the new truth. `mutation_in_flight` means an
 *    earlier attempt is still being confirmed. Both are distinguishable here, by code, rather than by
 *    matching on message text.
 */

const cardsKey = ["efs_cards"] as const;

/** The shape the API returns for a recorded outcome — including the ones that did not succeed. */
export interface CardMutationOutcome {
  ok: boolean;
  mutationId: string;
  status: Exclude<CardMutationStatus, "pending">;
  version: string | null;
  driftFields: string[];
  faultCode: string | null;
  faultMessage: string | null;
}

export interface CardMutationHistoryRow {
  id: string;
  intent: CardMutationIntent;
  status: CardMutationStatus;
  reason: string;
  requestedBy: string | null;
  stepUp: boolean;
  createdAt: string;
  completedAt: string | null;
  efsFaultCode: string | null;
  efsFaultMessage: string | null;
  driftFields: string[] | null;
}

/**
 * An API refusal with its CODE preserved.
 *
 * `apiFetch` never throws and vue-query needs it to, but a bare `Error(message)` throws away the one
 * field the drawer branches on. A 409 that has to be matched by reading its sentence is a 409 that
 * breaks the first time somebody improves the wording.
 */
export class CardControlApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
    /** Extra fields the API attaches: `currentVersion`, `maxAgeSec`, `limit`, … */
    public detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "CardControlApiError";
  }
}

async function call<T>(
  path: string,
  method: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await apiFetch<T>(path, { method, ...(body === undefined ? {} : { body }), ...(headers ? { headers } : {}) });
  if (!res.ok) {
    throw new CardControlApiError(
      res.error?.message ?? "That did not work",
      res.error?.code ?? "unknown",
      res.status,
      res.detail ?? {},
    );
  }
  return res.data as T;
}

/**
 * One key per intent per drawer-open, reused across retries of that same action.
 *
 * Minted here rather than per REQUEST on purpose: a fresh key on every attempt would make the replay
 * guard inert exactly when it matters, which is the retry.
 */
export const newIdempotencyKey = (): string => crypto.randomUUID();

interface WriteArgs {
  cardId: string;
  expectedVersion: string;
  reason: string;
  idempotencyKey: string;
}

const withKey = (key: string): Record<string, string> => ({ "Idempotency-Key": key });

/** Invalidate the card, its history and the list — a mutation moves all three. */
function useCardInvalidation() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: cardsKey });
}

export function useLockCard() {
  const invalidate = useCardInvalidation();
  return useMutation({
    mutationFn: (args: WriteArgs & { status: "Hold" | "Inactive" }) =>
      call<CardMutationOutcome>(
        `/api/fuel-cards/${args.cardId}/lock`, "POST",
        { expectedVersion: args.expectedVersion, reason: args.reason, status: args.status },
        withKey(args.idempotencyKey),
      ),
    onSuccess: invalidate,
  });
}

export function useUnlockCard() {
  const invalidate = useCardInvalidation();
  return useMutation({
    mutationFn: (args: WriteArgs) =>
      call<CardMutationOutcome>(
        `/api/fuel-cards/${args.cardId}/unlock`, "POST",
        { expectedVersion: args.expectedVersion, reason: args.reason },
        withKey(args.idempotencyKey),
      ),
    onSuccess: invalidate,
  });
}

export function useGrantOverride() {
  const invalidate = useCardInvalidation();
  return useMutation({
    mutationFn: (args: WriteArgs & { uses: number; scope: OverrideScope }) =>
      call<CardMutationOutcome>(
        `/api/fuel-cards/${args.cardId}/override`, "POST",
        { expectedVersion: args.expectedVersion, reason: args.reason, uses: args.uses, scope: args.scope },
        withKey(args.idempotencyKey),
      ),
    onSuccess: invalidate,
  });
}

export function useClearOverride() {
  const invalidate = useCardInvalidation();
  return useMutation({
    mutationFn: (args: WriteArgs) =>
      call<CardMutationOutcome>(
        `/api/fuel-cards/${args.cardId}/override`, "DELETE",
        { expectedVersion: args.expectedVersion, reason: args.reason },
        withKey(args.idempotencyKey),
      ),
    onSuccess: invalidate,
  });
}

export function useSetPrompts() {
  const invalidate = useCardInvalidation();
  return useMutation({
    mutationFn: (args: WriteArgs & { prompts: PromptInput[]; allowRemoveDriverId: boolean }) =>
      call<CardMutationOutcome>(
        `/api/fuel-cards/${args.cardId}/prompts`, "POST",
        {
          expectedVersion: args.expectedVersion,
          reason: args.reason,
          // Always the literal `true`. Full replace is the EFS semantic and the API refuses anything
          // else; sending it explicitly means the client can never arrive at it by omission either.
          replaceAll: true,
          prompts: args.prompts,
          allowRemoveDriverId: args.allowRemoveDriverId,
        },
        withKey(args.idempotencyKey),
      ),
    onSuccess: invalidate,
  });
}

/** The change history for one card. A read: open to everyone who can view the card. */
export function useCardMutations(cardId: Ref<string>) {
  return useQuery({
    queryKey: computed(() => [...cardsKey, "history", cardId.value] as const),
    queryFn: (): Promise<{ mutations: CardMutationHistoryRow[] }> =>
      call(`/api/fuel-cards/${cardId.value}/history`, "GET"),
    enabled: computed(() => !!cardId.value),
  });
}

// ─── Settings (admin) ──────────────────────────────────────────────────────────────────────────

export interface CardControlProbeStep {
  step: number;
  name: string;
  ok: boolean;
  ms: number;
  detail?: string;
  errorCode?: string;
  error?: string;
}

export interface CardControlProbeResult {
  environment: string;
  readOnly: boolean;
  entitlement: "unknown" | "confirmed" | "denied";
  recommendation: string;
  verdict: string;
  steps: CardControlProbeStep[];
  /**
   * `flat` or `nested:<wrapper>`. A QA account and a production account are two different EFS
   * installations, and a clean round-trip on one only transfers to the other if both answer in the
   * same structure — so this is evidence, not trivia. Optional because a run that never reached
   * step 3 has no document to describe.
   */
  documentShape?: string | null;
  /** The card as EFS sent it, PANs already masked server-side. The fixture for the next bug. */
  document?: string | null;
  /** The address EFS saw us dial from — the one that has to be on their allowlist, per environment. */
  egressIp?: string | null;
  /** The card after the write, PANs masked. Present only when step 6 ran. */
  documentAfter?: string | null;
  /** Exactly what a no-op echo moved. Empty on a clean run; this is the finding when it is not. */
  changed?: { path: string; expected: string[]; actual: string[] }[];
  persisted: boolean;
}

/**
 * Run the EFS write check.
 *
 * `readOnly: true` is the default everywhere it is offered: it proves the echo against this account's
 * real vendor XML and touches nothing. The write half needs a card WEX has confirmed is disposable,
 * a typed confirmation, and a sign-in from the last five minutes.
 */
export function useCardControlProbe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { cardNumber: string; confirm: string; readOnly: boolean }) =>
      call<CardControlProbeResult>("/api/fuel-cards/write-check", "POST", args),
    onSuccess: () => void qc.invalidateQueries({ queryKey: cardsKey }),
  });
}
