import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { computed, type Ref } from "vue";
import type {
  CardMutationIntent,
  CardMutationStatus,
  OverrideLimit,
  OverrideScope,
  PromptInput,
} from "@fuelguard/shared";
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
 *    the operator; the API payload carries the fresh document and the drawer seeds it immediately while
 *    the parent refetch repairs the mirror. `mutation_in_flight` means an earlier attempt is still being
 *    confirmed. Both are distinguishable here, by code, rather than by matching on message text.
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
  /**
   * True when the API replayed a settled prior attempt for this Idempotency-Key rather than doing
   * anything new (audit P1-2). Surfaced so the operator hears "this matches an earlier attempt"
   * instead of a fresh success/failure — the two are not the same and one of them is a lie.
   */
  idempotent?: boolean;
}

export interface CardMutationHistoryRow {
  id: string;
  intent: CardMutationIntent;
  status: CardMutationStatus;
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
  idempotencyKey: string;
}

const withKey = (key: string): Record<string, string> => ({ "Idempotency-Key": key });

/** Invalidate the card, its history and the list — a mutation moves all three. */
function useCardInvalidation() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: cardsKey });
}

/**
 * `clearException` is a REQUIRED argument here, not an optional one with a default.
 *
 * The drawer has offered the clear-and-lock checkbox since H16's Option B, `cardLock.view.ts` writes
 * a confirmation clause promising the exception leaves in the same write, and the flag was dropped
 * on this line — so the request arrived with the schema's `false`, `cardLock.behaviour.ts`'s
 * precondition refused it, and the operator was shown `CARD_LOCK_OVERRIDE_BLOCKED`, the dead-end
 * sentence the checkbox exists to avoid. Optional-with-a-default is what let a forgotten field
 * typecheck; the same reason `overrideGrantEdits` refuses to default `limits`.
 */
export function useLockCard() {
  const invalidate = useCardInvalidation();
  return useMutation({
    mutationFn: (args: WriteArgs & { status: "Hold" | "Inactive"; clearException: boolean }) =>
      call<CardMutationOutcome>(
        `/api/fuel-cards/${args.cardId}/lock`, "POST",
        { expectedVersion: args.expectedVersion, status: args.status, clearException: args.clearException },
        withKey(args.idempotencyKey),
      ),
    onSuccess: invalidate,
  });
}

/**
 * Retiring a card. No status in the body — `card_deactivate` writes exactly one and carries none,
 * which is why this cannot be folded into `useLockCard` with a wider argument.
 */
export function useDeactivateCard() {
  const invalidate = useCardInvalidation();
  return useMutation({
    mutationFn: (args: WriteArgs) =>
      call<CardMutationOutcome>(
        `/api/fuel-cards/${args.cardId}/deactivate`, "POST",
        { expectedVersion: args.expectedVersion },
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
        { expectedVersion: args.expectedVersion },
        withKey(args.idempotencyKey),
      ),
    onSuccess: invalidate,
  });
}

/**
 * `limits` is required for the same reason, and carried now rather than when 10.3 needs it.
 *
 * Step 10.1 landed `grantOverrideSchema.limits` on the API and `cardOperations.ts` already builds the
 * field; this hop dropped it. It is harmless today — the drawer only ever sends `[]`, which is what
 * the schema defaults to — and it would have been the whole of 10.3's product override going missing
 * silently the moment the picker started filling it in.
 */
export function useGrantOverride() {
  const invalidate = useCardInvalidation();
  return useMutation({
    mutationFn: (args: WriteArgs & { uses: number; scope: OverrideScope; limits: OverrideLimit[] }) =>
      call<CardMutationOutcome>(
        `/api/fuel-cards/${args.cardId}/override`, "POST",
        { expectedVersion: args.expectedVersion, uses: args.uses, scope: args.scope, limits: args.limits },
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
        { expectedVersion: args.expectedVersion },
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
/**
 * Re-read ONE card from EFS, now (Step 7.8).
 *
 * ── What this closes ────────────────────────────────────────────────────────────────────────────
 * `POST /api/fuel-cards/:id/refresh` has existed since the read routes were built and NOTHING in the
 * browser has ever called it — a component, a hook and an endpoint with no caller is the exact shape
 * the Phase 6 audit found and closed once already. Meanwhile `freshness()` has been telling
 * operators "Refresh to see current settings." on a page that offered no way to do it.
 *
 * ── Why per-card and not "refresh everything" ───────────────────────────────────────────────────
 * One paced vendor call on the interactive lane, started by a person who is looking at that card.
 * The alternative reading of Step 7.8 — re-read every card on the override panel whenever the panel
 * is viewed — would fire one vendor call per exception on a page that already polls every 60s, which
 * is the "excessive polling" the guide warns can get the shared service account suspended (p11), and
 * the step itself says not to spend vendor budget on the whole fleet to fix one field.
 *
 * Not a card MUTATION: no idempotency key, no expectedVersion, no step-up. It writes to our mirror
 * from what EFS reports and changes nothing at the vendor — which is why it is gated at `canView`.
 */
export function useRefreshCard() {
  const invalidate = useCardInvalidation();
  return useMutation({
    mutationFn: (cardId: string) =>
      call<{ ok: boolean; version: string }>(`/api/fuel-cards/${cardId}/refresh`, "POST"),
    onSuccess: invalidate,
  });
}

export function useCardControlProbe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { cardNumber: string; confirm: string; readOnly: boolean }) =>
      call<CardControlProbeResult>("/api/fuel-cards/write-check", "POST", args),
    onSuccess: () => void qc.invalidateQueries({ queryKey: cardsKey }),
  });
}

// ─── The account-wide change log (Step 6.6) ────────────────────────────────────────────────────

export interface CardMutationLogFilters {
  /** Narrow to one card — set by the card page's "Change history" deep link. */
  cardId?: string;
  search?: string;
  from?: string;
  to?: string;
}

export interface CardMutationLogRow extends CardMutationHistoryRow {
  cardId: string | null;
  maskedRef: string;
  unitPrompt: string | null;
  driverName: string | null;
}

/**
 * Every card change on the account, filtered — the Audit Log page's "Card changes" tab.
 *
 * Goes through the API rather than Supabase, unlike the Activity tab beside it. That is not a style
 * choice: `efs_card_mutations` has RLS enabled and no policy, so a browser query returns an empty
 * list rather than an error, and the tab would look like a card nobody had ever changed.
 */
export function useCardMutationLog(
  filters: Ref<CardMutationLogFilters>,
  page: Ref<number>,
  pageSize: number,
) {
  return useQuery({
    queryKey: computed(() => [...cardsKey, "mutation-log", filters.value, page.value] as const),
    queryFn: (): Promise<{ mutations: CardMutationLogRow[]; total: number }> => {
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String((page.value - 1) * pageSize),
      });
      for (const [key, value] of Object.entries(filters.value)) {
        if (value) params.set(key, value);
      }
      return call(`/api/fuel-cards/mutations?${params.toString()}`, "GET");
    },
  });
}
