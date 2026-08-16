<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { CardCapabilities, PromptInput, WsCard } from "@fuelguard/shared";
import { EFS_EDITABLE_INFO_IDS } from "@fuelguard/shared";
import { AppButton as BaseButton } from "@fuelguard/ui";
import SlideOver from "@/components/SlideOver.vue";
import StepUpPrompt from "@/components/StepUpPrompt.vue";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useToastStore } from "@/stores/toast";
import CardOperationInputs from "./CardOperationInputs.vue";
import CardOperationResult from "./CardOperationResult.vue";
import { outcomeNotice } from "./cardControlModel";
import { handleOperationFailure } from "./cardOperationFailure";
import {
  type CardOperationSpec,
  type OperationDraft,
  blockedSentence,
  seedDraftFor,
  operationBlockedBy,
  operationConfirmation,
  operationDiff,
  operationStepUp,
  operationUi,
  capabilityBlockedBy,
  statusRows,
  missingEditableInfoIds,
  unwritableStatusLabel,
  toOperationCard,
} from "./cardOperations";
import {
  newIdempotencyKey,
  useClearOverride,
  useGrantOverride,
  useLockCard,
  useSetPrompts,
  useUnlockCard,
  type CardMutationOutcome,
} from "./useCardControl";

/**
 * ONE operation, start to finish — Phase 6's answer to docs/28's Problem 3.
 *
 * The drawer it replaces stacked Lock, Exception and Prompts into one panel with three action
 * buttons, so "lock this card" meant reading past two forms that were not the decision. This opens
 * on the operation somebody chose and shows five regions: header · what this does · inputs ·
 * **what will change** · footer.
 *
 * There is no "Why" field. Decision B1 removed it on 2026-08-12; a session reinstated it
 * per-capability on 2026-08-13 and Phase 6 shipped it as a REQUIRED box in front of the person who
 * had deleted it. Phase 6.5 took it back out of the logic, not just the form — see the note on
 * `cardControlContract.ts`. The ledger records time, person and action, which is the audit trail.
 *
 * ── The seven invariants, and the defect each one prevents ──────────────────────────────────────
 *
 * 1. **Snapshot on confirm.** The body and the diff are frozen when Confirm is pressed and the
 *    dispatch sends the frozen object. Without it, a reseed or a stray keystroke between the click
 *    and the network call means the operator authorised one change and the API performed another.
 *
 * 2. **Reseeding pauses while dirty.** A fresh parent fetch arriving mid-edit shows a banner
 *    offering to reload; it never overwrites. The 60s poll would otherwise wipe half-typed input.
 *
 * 3. **Dirty guard** on ESC, scrim, ✕ and Cancel — one accidental Escape must not discard work.
 *
 * 4. **The result stays in the drawer**, with a link to this card's history. On `sent` the retry
 *    button is DISABLED: that outcome means we do not know whether the write landed, and retrying
 *    could apply it twice.
 *
 * 5. **Step-up is predicted, not discovered** (`operationStepUp` → `@fuelguard/shared`'s
 *    `efs/stepUp.ts`, the same predicates the API refuses with). The refusal path stays as a
 *    fallback: two of the three gates decide against the document EFS returns at write time, and
 *    this only has the mirror.
 *
 * 6. **Disabled is explained.** Every disabled Confirm names the missing input or the missing
 *    scope, and an operation blocked for this org says who to ask.
 *
 * 7. **Environment and promotion state in the header**, so nobody learns they were on sandbox — or
 *    that this action was never approved here — from a 403 after pressing the button.
 *
 * ── Lifted verbatim from `CardControlDrawer.vue`, because they were right ───────────────────────
 * Per-operation idempotency keys, re-minted at every settled outcome with `sent` as the sole
 * exception (audit P1-2); the re-entrancy guard (web finding #5); the card-identity reseed (web
 * finding #2); and reading the outcome from `status` rather than the HTTP code, since the API
 * answers 200 for every RECORDED outcome including the ones that did not work.
 */

const props = defineProps<{
  open: boolean;
  operation: CardOperationSpec | null;
  cardId: string;
  maskedRef: string;
  version: string;
  status: string;
  overrideUses: number | null;
  overrideAllLocations: boolean | null;
  locationOverrideId: string | null;
  prompts: { infoId: string; validationType: string | null; matchValue: string | null; reportValue: string | null }[];
  capabilities: CardCapabilities;
  scopes: readonly string[];
}>();

const emit = defineEmits<{ close: []; changed: [] }>();

const toast = useToastStore();

const draft = ref<OperationDraft>(seedDraftFor(null, props.status, []));
const activeVersion = ref(props.version);
const activePrompts = ref(props.prompts);
const activeStatus = ref(props.status);
const busy = ref(false);
const key = ref("");

/** Invariant 1: frozen at the click, and what `dispatch` actually sends. */
const committed = ref<{ body: Record<string, unknown> } | null>(null);
/** Invariant 4: the recorded outcome, kept on screen rather than toasted away. */
const settled = ref<CardMutationOutcome | null>(null);
/** Invariant 5 / the fallback: set when the API asks, or when the view predicted and we ask first. */
const stepUpFor = ref<string | null>(null);
/** Invariant 2: a newer card arrived while the operator was mid-edit. Offered, never applied. */
const pendingReseed = ref(false);
/** Invariant 3: shown instead of closing when there is work to lose. */
const confirmingDiscard = ref(false);

const lock = useLockCard();
const unlock = useUnlockCard();
const grant = useGrantOverride();
const clear = useClearOverride();
const setPrompts = useSetPrompts();

const readOnlyPrompts = computed(() =>
  activePrompts.value.filter((p) => !(EFS_EDITABLE_INFO_IDS as readonly string[]).includes(p.infoId)));

function seed(): void {
  activeVersion.value = props.version;
  activePrompts.value = props.prompts;
  activeStatus.value = props.status;
  draft.value = seedDraftFor(props.operation, props.status, props.prompts);
  committed.value = null;
  settled.value = null;
  stepUpFor.value = null;
  pendingReseed.value = false;
  confirmingDiscard.value = false;
  key.value = newIdempotencyKey();
}

/**
 * Dirty means "there is work an accidental Escape would lose".
 *
 * Compared against a freshly seeded draft rather than tracked with a flag, so a value typed and then
 * typed back is correctly not dirty — a guard that fires on a no-op edit is one people learn to
 * click through.
 */
const dirty = computed(() => {
  const clean = seedDraftFor(props.operation, activeStatus.value, activePrompts.value);
  return JSON.stringify(draft.value) !== JSON.stringify(clean);
});

/**
 * What the drawer is currently seeded FOR. Null before the first seed and after it closes.
 *
 * Not cosmetic bookkeeping: without it the very first pass through the watcher below is judged by
 * `dirty`, which compares an empty initial draft against one seeded from the card's prompts and so
 * reads TRUE on a drawer nobody has touched. The drawer then skipped its own first seed — no prompt
 * drafts, and an EMPTY idempotency key on the first dispatch.
 */
const seededFor = ref<string | null>(null);

/**
 * Reseed on OPEN and on any change to the card identity or the document it was drawn from.
 *
 * A change of CARD or OPERATION always reseeds, dirty or not — carrying card A's draft or key to
 * card B is audit finding web #2, and there is no draft worth preserving across that. Everything
 * else respects the dirty pause (invariant 2) and the result on screen (invariant 4).
 */
watch(
  () => [props.open, props.cardId, props.operation?.id, props.version, props.prompts] as const,
  ([open, cardId, operationId]) => {
    if (!open) {
      seededFor.value = null;
      return;
    }
    const target = `${cardId}:${operationId ?? ""}`;
    if (seededFor.value !== target) {
      seed();
      seededFor.value = target;
      return;
    }
    if (dirty.value || settled.value || busy.value) {
      pendingReseed.value = props.version !== activeVersion.value;
      return;
    }
    seed();
  },
  { immediate: true },
);

const card = computed(() => toOperationCard({
  status: activeStatus.value,
  infos: activePrompts.value as WsCard["infos"],
  // The card's limits are not editable by any capability yet, so the views never read them.
  limits: [],
  overrideUses: props.overrideUses,
  overrideAllLocations: props.overrideAllLocations,
  locationOverrideId: props.locationOverrideId,
}));

const context = computed(() => ({
  maskedRef: props.maskedRef,
  card: card.value,
  locationLabel: (locationId: string): string | null =>
    (draft.value.location?.locId === locationId
      ? [draft.value.location.name, draft.value.location.city, draft.value.location.state].filter(Boolean).join(", ")
      : null),
}));

/** The live body while editing; the frozen one once Confirm has been pressed (invariant 1). */
const body = computed<Record<string, unknown>>(() =>
  committed.value?.body ?? (props.operation ? props.operation.body(draft.value) : {}));

const ui = computed(() => (props.operation ? operationUi(props.operation) : null));
const confirmation = computed(() =>
  (props.operation ? operationConfirmation(props.operation, body.value, context.value, draft.value) : null));
const diffRows = computed(() =>
  (props.operation ? operationDiff(props.operation, card.value, body.value, draft.value) : []));
const predictedStepUp = computed(() =>
  (props.operation ? operationStepUp(props.operation, body.value, context.value, draft.value) : null));

/** The three rows, and why each is or is not reachable — see `capabilityFor` on the status spec. */
const rows = computed(() => statusRows(activeStatus.value));
const statusBlocked = computed<Record<string, string | null>>(() => Object.fromEntries(
  rows.value.map((r) => [r.value, capabilityBlockedBy(r.capabilityKey, r.scope, props.capabilities, props.scopes)]),
));
const unwritable = computed(() => unwritableStatusLabel(activeStatus.value));

/** The prompts this card does not yet carry — what `promptAdd` may offer. */
const addOptions = computed(() => missingEditableInfoIds(card.value));

/** Saving the status the card already has is a vendor call that changes nothing. */
const statusUnchanged = computed(() =>
  props.operation?.id === "status" && rows.value.some((r) => r.current && r.value === draft.value.targetStatus));

const diffColumns: DataTableColumn[] = [
  { key: "label", label: "Setting", cellClass: "font-medium text-ink" },
  { key: "before", label: "Now", cellClass: "text-ink-secondary" },
  { key: "after", label: "After", cellClass: "text-ink" },
];

const blockedBy = computed(() =>
  (props.operation ? operationBlockedBy(props.operation, props.capabilities, props.scopes, draft.value) : null));

/** Invariant 6 — the SENTENCE, never a boolean. The footer renders it beside the disabled button. */
const missing = computed<string | null>(() => {
  if (!props.operation) return null;
  if (blockedBy.value) return blockedSentence(blockedBy.value);
  if (!props.operation.applies(card.value)) return "This card is not in a state where that applies.";
  const blocker = props.operation.blocker?.(draft.value);
  if (blocker) return blocker;
  if (statusUnchanged.value) return "This card is already at that status.";
  return null;
});

const canConfirm = computed(() => missing.value === null && !busy.value);

function confirm(): void {
  if (!props.operation || !canConfirm.value) return; // re-entrancy guard (web finding #5)
  // Invariant 1: freeze both halves NOW. Everything below reads `committed`, so a reseed arriving
  // mid-flight cannot change what was authorised.
  committed.value = { body: props.operation.body(draft.value) };
  // Invariant 5: ask first when the rule says this will be asked, rather than spending a request to
  // be told. An unpredicted refusal still lands in `handleFailure`.
  if (predictedStepUp.value) {
    stepUpFor.value = predictedStepUp.value;
    return;
  }
  void run();
}

async function run(): Promise<void> {
  if (!props.operation || !committed.value || busy.value) return;
  busy.value = true;
  try {
    const outcome = await dispatch();
    settled.value = outcome;
    const notice = outcomeNotice(outcome, confirmation.value?.doneLabel ?? "Done");
    if (notice.kind === "success") toast.success(notice.title, notice.message);
    else if (notice.kind === "warning") toast.warning(notice.title, notice.message);
    else toast.error(notice.title, notice.message);
    emit("changed");
    // A key is spent the moment its request SETTLES with a known outcome. `sent` is the sole
    // exception: its outcome is unknown, and re-clicking must replay "still unconfirmed" rather
    // than chance a second apply — which is also why the retry button is disabled on it.
    if (outcome.status !== "sent") key.value = newIdempotencyKey();
  } catch (error) {
    handleFailure(error);
  } finally {
    busy.value = false;
  }
}

function dispatch(): Promise<CardMutationOutcome> {
  const frozen = committed.value!;
  const common = {
    cardId: props.cardId,
    expectedVersion: activeVersion.value,
    idempotencyKey: key.value,
  };
  const b = frozen.body;
  switch (props.operation!.id) {
    // Dispatched by the CHOSEN value, not by the operation: `card_unlock` is the only path to
    // Active, and routing Active through the lock endpoint is audit P0-3.
    case "status":
      return b.status === undefined
        ? unlock.mutateAsync(common)
        : lock.mutateAsync({ ...common, status: b.status as "Hold" | "Inactive" });
    case "grant":
      return grant.mutateAsync({ ...common, uses: b.uses as number, scope: b.scope as never });
    case "clear":
      return clear.mutateAsync(common);
    case "promptAdd":
    case "prompts":
      return setPrompts.mutateAsync({
        ...common,
        prompts: b.prompts as PromptInput[],
        allowRemoveDriverId: b.allowRemoveDriverId as boolean,
      });
  }
}

/** Every branch lives in `cardOperationFailure.ts`; this binds them to the drawer's own state. */
function handleFailure(error: unknown): void {
  handleOperationFailure(error, {
    stepUp: (reason) => { stepUpFor.value = reason; },
    cardMoved: (version, live) => {
      activeVersion.value = version;
      activePrompts.value = live.infos;
      activeStatus.value = live.status ?? props.status;
      draft.value = seedDraftFor(props.operation, live.status ?? props.status, live.infos);
      committed.value = null;
    },
    abandon: () => { committed.value = null; },
    rekey: () => { key.value = newIdempotencyKey(); },
    refetch: () => emit("changed"),
    notify: (_kind, title, message) => toast.error(title, message),
  });
}

async function afterStepUp(): Promise<void> {
  stepUpFor.value = null;
  await run();
}

/** ESC during step-up cancels the STEP-UP, not the drawer (Step 6.4's accessibility pass). */
function cancelStepUp(): void {
  stepUpFor.value = null;
  committed.value = null;
}

function requestClose(): void {
  if (busy.value) return; // never close over an in-flight vendor call
  if (stepUpFor.value) return cancelStepUp();
  if (dirty.value && !settled.value) {
    confirmingDiscard.value = true;
    return;
  }
  emit("close");
}

function applyReseed(): void {
  pendingReseed.value = false;
  seed();
}

const environmentBadge = computed(() =>
  (props.capabilities.environment === "sandbox" ? "Sandbox — writes do not reach live cards" : null));
</script>

<template>
  <SlideOver
    :open="props.open"
    size="lg"
    :title="ui?.title ?? 'Card action'"
    :description="`${props.maskedRef} — changes take effect at the pump immediately.`"
    @close="requestClose"
  >
    <div v-if="props.operation" class="space-y-6">
      <!-- ── Region 1: header ─────────────────────────────────────────────────────────────────── -->
      <div class="flex flex-wrap items-center gap-2">
        <span v-if="environmentBadge" :class="[BADGE_BASE, toneClass('info')]">{{ environmentBadge }}</span>
        <span v-if="blockedBy" :class="[BADGE_BASE, toneClass('neutral')]">Not available here</span>
      </div>

      <!-- Invariant 3, and invariant 4's exit: one decision on screen at a time. -->
      <div v-if="confirmingDiscard" class="space-y-4" aria-labelledby="discard-heading">
        <h3 id="discard-heading" class="text-base font-semibold text-ink">Discard this change?</h3>
        <p class="text-sm leading-6 text-ink-muted">Nothing has been sent to EFS. What you typed will be lost.</p>
        <div class="flex justify-end gap-3">
          <BaseButton @click="confirmingDiscard = false">Keep editing</BaseButton>
          <BaseButton variant="danger" @click="emit('close')">Discard</BaseButton>
        </div>
      </div>

      <!-- Step-up replaces the body, like a confirmation. -->
      <StepUpPrompt
        v-else-if="stepUpFor"
        :reason="stepUpFor"
        @confirmed="afterStepUp"
        @cancel="cancelStepUp"
      />

      <!-- ── Invariant 4: the recorded outcome, kept where the operator can act on it ─────────── -->
      <CardOperationResult
        v-else-if="settled"
        :outcome="settled"
        :done-label="confirmation?.doneLabel ?? 'Done'"
        :card-id="props.cardId"
        @retry="seed()"
      />

      <template v-else>
        <!-- ── Region 2: what this does ───────────────────────────────────────────────────────── -->
        <section v-if="confirmation" class="space-y-2" aria-labelledby="intent-heading">
          <h3 id="intent-heading" class="text-base font-semibold text-ink">{{ confirmation.title }}</h3>
          <p class="text-sm leading-6 text-ink-muted">{{ confirmation.body }}</p>
        </section>

        <p v-if="blockedBy" class="rounded-control bg-surface-subtle px-3 py-2 text-sm text-ink">
          {{ blockedSentence(blockedBy) }}
        </p>

        <!-- Invariant 2: offered, never applied. -->
        <div
          v-if="pendingReseed"
          class="flex flex-wrap items-center justify-between gap-3 rounded-control bg-caution-50 px-3 py-2 text-sm text-caution-700"
        >
          <span>This card changed in EFS while you were editing. Your changes are still here.</span>
          <BaseButton variant="ghost" size="sm" @click="applyReseed">Reload the card</BaseButton>
        </div>

        <!-- ── Region 3: inputs ───────────────────────────────────────────────────────────────── -->
        <CardOperationInputs
          :operation="props.operation.id"
          :draft="draft"
          :busy="busy"
          :read-only-prompts="readOnlyPrompts"
          :add-options="addOptions"
          :status-rows="rows"
          :status-blocked="statusBlocked"
          :unwritable-status="unwritable"
          @update:draft="draft = $event"
        />

        <!-- ── Region 4: what will change ─────────────────────────────────────────────────────── -->
        <section v-if="diffRows.length > 0" class="space-y-2" aria-labelledby="diff-heading">
          <h3 id="diff-heading" class="text-sm font-semibold text-ink">What will change</h3>
          <DataTable :columns="diffColumns" :rows="diffRows" row-key="label" dense empty-text="" />
        </section>


        <!-- Invariant 5: said before the button, not after the request. -->
        <p v-if="predictedStepUp" class="rounded-control bg-surface-subtle px-3 py-2 text-sm text-ink-secondary">
          {{ predictedStepUp }}
        </p>
      </template>
    </div>

    <template #footer>
      <div v-if="props.operation && !settled && !stepUpFor && !confirmingDiscard" class="space-y-2">
        <!-- Invariant 6: the sentence sits WITH the disabled button, not in a tooltip. -->
        <p v-if="missing" class="text-right text-sm text-ink-muted">{{ missing }}</p>
        <div class="flex items-center justify-end gap-3">
          <BaseButton :disabled="busy" @click="requestClose">Cancel</BaseButton>
          <BaseButton
            :variant="confirmation?.tone === 'danger' ? 'danger' : 'primary'"
            :disabled="!canConfirm"
            @click="confirm"
          >
            {{ busy ? confirmation?.busyLabel ?? "Working…" : confirmation?.confirmLabel ?? "Confirm" }}
          </BaseButton>
        </div>
      </div>
      <div v-else-if="settled" class="flex items-center justify-end">
        <BaseButton variant="primary" @click="emit('close')">Close</BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
