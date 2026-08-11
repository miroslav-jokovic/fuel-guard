<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { CardCapabilities, EfsLocation, PromptInput } from "@fuelguard/shared";
import { EFS_EDITABLE_INFO_IDS, efsStatusEquals } from "@fuelguard/shared";
import { AppIcon } from "@fuelguard/ui";
import { ExclamationTriangleIcon } from "@fuelguard/ui/icons";
import SlideOver from "@/components/SlideOver.vue";
import { AppButton as BaseButton } from "@fuelguard/ui";
import StepUpPrompt from "@/components/StepUpPrompt.vue";
import { useToastStore } from "@/stores/toast";
import CardOverridePanel from "./CardOverridePanel.vue";
import CardPromptsPanel from "./CardPromptsPanel.vue";
import CardStatusPanel from "./CardStatusPanel.vue";
import {
  clearOverrideConfirmation,
  lockConfirmation,
  outcomeNotice,
  overrideConfirmation,
  promptsConfirmation,
  unlockConfirmation,
  type CardConfirmation,
} from "./cardControlModel";
import {
  CardControlApiError,
  newIdempotencyKey,
  useClearOverride,
  useGrantOverride,
  useLockCard,
  useSetPrompts,
  useUnlockCard,
  type CardMutationOutcome,
} from "./useCardControl";

/**
 * Every way this product can change a fuel card, behind one confirmation.
 *
 * Copies `features/roster/DriverAccessModal.vue` deliberately: a typed action union, a `confirmation`
 * computed returning the exact words, the confirmation REPLACING the drawer body rather than stacking
 * a second modal on top of it, a `busy` computed OR-ing every mutation, and a `#footer` that swaps
 * with the body state.
 *
 * ── Three things this drawer does that a normal form does not ────────────────────────────────────
 *
 * 1. **It sends the version the screen was DRAWN from.** Not a fresh one. If the card moved in the
 *    WEX portal since, the API answers 409 and the operator is shown the new truth instead of
 *    silently overwriting somebody's change.
 *
 * 2. **One idempotency key per action per open.** Reused across retries of the SAME action, so a
 *    double click or a retried request cannot grant two overrides.
 *
 * 3. **A 200 is not a success.** The API answers 200 for every recorded outcome, including "EFS
 *    refused" and "we could not confirm". `outcomeNotice` decides which of those the operator hears,
 *    and "sent but not confirmed" is never dressed up as either a success or a failure.
 */

const props = defineProps<{
  open: boolean;
  cardId: string;
  maskedRef: string;
  version: string;
  status: string;
  lastUsedDate: string | null;
  driverName: string | null;
  unitPrompt: string | null;
  overrideUses: number | null;
  overrideAllLocations: boolean | null;
  locationOverrideId: string | null;
  prompts: { infoId: string; validationType: string | null; matchValue: string | null }[];
  capabilities: CardCapabilities;
}>();

const emit = defineEmits<{ close: []; changed: [] }>();

const toast = useToastStore();

type Tab = "status" | "override" | "prompts";
type ConfirmAction = "lock" | "unlock" | "override" | "clearOverride" | "prompts";

const tab = ref<Tab>("status");
const confirmAction = ref<ConfirmAction | null>(null);
/** Set when the API asks for a fresh sign-in; the prompt replaces the body, like a confirmation. */
const stepUpFor = ref<ConfirmAction | null>(null);

const reason = ref("");
const lockStatus = ref<"Hold" | "Inactive">("Hold");
const uses = ref(1);
const scopeKind = ref<"all" | "location">("all");
const location = ref<EfsLocation | null>(null);
const drafts = ref<PromptInput[]>([]);

/**
 * One key per action per drawer-open. Minted when the drawer opens rather than per request, because
 * the request the guard has to catch is the RETRY.
 */
const keys = ref<Record<ConfirmAction, string>>({
  lock: "", unlock: "", override: "", clearOverride: "", prompts: "",
});

const lock = useLockCard();
const unlock = useUnlockCard();
const grant = useGrantOverride();
const clear = useClearOverride();
const setPrompts = useSetPrompts();

const busy = computed(
  () => lock.isPending.value || unlock.isPending.value || grant.isPending.value
    || clear.isPending.value || setPrompts.isPending.value,
);

const editablePrompts = computed(() =>
  props.prompts.map((p) => ({ ...p, editable: (EFS_EDITABLE_INFO_IDS as readonly string[]).includes(p.infoId) })),
);

/** Reset every draft when the drawer opens: a stale reason from last time is an audit-log lie. */
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    tab.value = "status";
    confirmAction.value = null;
    stepUpFor.value = null;
    reason.value = "";
    lockStatus.value = "Hold";
    uses.value = 1;
    scopeKind.value = "all";
    location.value = null;
    keys.value = {
      lock: newIdempotencyKey(), unlock: newIdempotencyKey(), override: newIdempotencyKey(),
      clearOverride: newIdempotencyKey(), prompts: newIdempotencyKey(),
    };
    // Only the editable prompts become drafts. Everything else is echoed untouched by the API.
    drafts.value = props.prompts
      .filter((p) => (EFS_EDITABLE_INFO_IDS as readonly string[]).includes(p.infoId))
      .map((p) => ({
        infoId: p.infoId as PromptInput["infoId"],
        validationType: p.validationType === "REPORT_ONLY" ? "REPORT_ONLY" : "EXACT_MATCH",
        matchValue: p.matchValue,
      }));
  },
  { immediate: true },
);

const removesDriverId = computed(
  () => props.prompts.some((p) => p.infoId === "DRID")
    && !drafts.value.some((d) => d.infoId === "DRID" && (d.matchValue ?? "").trim() !== ""),
);

const locationLabel = computed(() =>
  location.value
    ? [location.value.name, location.value.city, location.value.state].filter(Boolean).join(", ")
    : null,
);

const confirmation = computed<CardConfirmation | null>(() => {
  switch (confirmAction.value) {
    case "lock": return lockConfirmation(lockStatus.value);
    case "unlock": return unlockConfirmation(efsStatusEquals(props.status, "Fraud"));
    case "override": return overrideConfirmation(uses.value, scopeKind.value === "location" ? locationLabel.value : null);
    case "clearOverride": return clearOverrideConfirmation();
    case "prompts": return promptsConfirmation(removesDriverId.value);
    default: return null;
  }
});

const tabs = computed(() =>
  [
    { key: "status" as const, label: "Lock", show: props.capabilities.canLock || props.capabilities.canUnlock },
    { key: "override" as const, label: "Exception", show: props.capabilities.canOverride },
    { key: "prompts" as const, label: "Prompts", show: props.capabilities.canSetPrompts },
  ].filter((t) => t.show),
);

const common = () => ({
  cardId: props.cardId,
  expectedVersion: props.version,
  reason: reason.value.trim(),
});

async function runConfirmedAction(): Promise<void> {
  const action = confirmAction.value;
  if (!action) return;
  const copy = confirmation.value!;
  try {
    const outcome = await dispatch(action);
    const notice = outcomeNotice(outcome, copy.doneLabel);
    if (notice.kind === "success") toast.success(notice.title, notice.message);
    else if (notice.kind === "warning") toast.warning(notice.title, notice.message);
    else toast.error(notice.title, notice.message);
    confirmAction.value = null;
    emit("changed");
    // Only a clean success closes the drawer. Anything else leaves the operator where they can read
    // the card's new state and decide what to do about it.
    if (notice.kind === "success") emit("close");
  } catch (error) {
    handleFailure(action, error);
  }
}

function dispatch(action: ConfirmAction): Promise<CardMutationOutcome> {
  switch (action) {
    case "lock":
      return lock.mutateAsync({ ...common(), idempotencyKey: keys.value.lock, status: lockStatus.value });
    case "unlock":
      return unlock.mutateAsync({ ...common(), idempotencyKey: keys.value.unlock });
    case "override":
      return grant.mutateAsync({
        ...common(), idempotencyKey: keys.value.override, uses: uses.value,
        scope: scopeKind.value === "all" ? { kind: "all" } : { kind: "location", locationId: location.value!.locId },
      });
    case "clearOverride":
      return clear.mutateAsync({ ...common(), idempotencyKey: keys.value.clearOverride });
    case "prompts":
      return setPrompts.mutateAsync({
        ...common(), idempotencyKey: keys.value.prompts,
        // A cleared value is a REMOVED prompt, not an empty one — the API refuses the record entirely.
        prompts: drafts.value.filter((d) => (d.matchValue ?? "").trim() !== ""),
        allowRemoveDriverId: removesDriverId.value,
      });
  }
}

/**
 * Failures that are not really failures.
 *
 * `card_state_changed` and `step_up_required` are both "do something first, then try again", and both
 * deserve a specific response rather than a red toast with a vendor sentence in it. Everything else
 * uses the house idiom.
 */
function handleFailure(action: ConfirmAction, error: unknown): void {
  const api = error instanceof CardControlApiError ? error : null;
  if (api?.code === "step_up_required") {
    stepUpFor.value = action;
    confirmAction.value = null;
    return;
  }
  if (api?.code === "card_state_changed") {
    confirmAction.value = null;
    emit("changed"); // refetch, so the drawer's props carry the version EFS actually holds
    toast.error("Card changed in EFS", "Review the current settings and try again.");
    return;
  }
  if (api?.code === "mutation_in_flight") {
    confirmAction.value = null;
    toast.error("Still confirming an earlier change", "Wait for it to finish, then try again.");
    return;
  }
  toast.error("Could not change the card", error instanceof Error ? error.message : undefined);
}

/** The step-up prompt succeeded: the token is fresh now, so re-run the action that needed it. */
async function afterStepUp(): Promise<void> {
  const action = stepUpFor.value;
  stepUpFor.value = null;
  if (!action) return;
  confirmAction.value = action;
  await runConfirmedAction();
}

function close(): void {
  if (busy.value) return; // never close over an in-flight vendor call
  emit("close");
}
</script>

<template>
  <SlideOver
    :open="props.open"
    title="Card actions"
    :description="`${props.maskedRef} — changes take effect at the pump immediately.`"
    @close="close"
  >
    <!-- Step-up replaces the body, like a confirmation: one decision on screen at a time. -->
    <StepUpPrompt
      v-if="stepUpFor"
      :reason="confirmation?.title ?? 'This action needs a recent sign-in.'"
      @confirmed="afterStepUp"
      @cancel="stepUpFor = null"
    />

    <div v-else-if="confirmation" class="flex min-h-[26rem] flex-col items-center justify-center text-center">
      <div
        class="flex size-12 items-center justify-center rounded-full"
        :class="confirmation.tone === 'danger' ? 'bg-danger-100 text-danger-700' : 'bg-warning-100 text-warning-700'"
      >
        <AppIcon :icon="ExclamationTriangleIcon" class="size-6" aria-hidden="true" />
      </div>
      <h3 class="mt-4 text-base font-semibold text-ink">{{ confirmation.title }}</h3>
      <p class="mt-2 max-w-sm text-sm leading-6 text-ink-muted">{{ confirmation.body }}</p>
      <p class="mt-4 max-w-sm text-sm text-ink-tertiary">Reason: {{ reason }}</p>
    </div>

    <div v-else class="space-y-5">
      <nav v-if="tabs.length > 1" class="flex gap-2" aria-label="Card actions">
        <BaseButton
          v-for="entry in tabs"
          :key="entry.key"
          size="sm"
          :variant="tab === entry.key ? 'primary' : 'ghost'"
          @click="tab = entry.key"
        >
          {{ entry.label }}
        </BaseButton>
      </nav>

      <CardStatusPanel
        v-if="tab === 'status'"
        v-model:reason="reason"
        v-model:lock-status="lockStatus"
        :status="props.status"
        :last-used-date="props.lastUsedDate"
        :driver-name="props.driverName"
        :unit-prompt="props.unitPrompt"
        :can-lock="props.capabilities.canLock"
        :can-unlock="props.capabilities.canUnlock"
        :busy="busy"
        @lock="confirmAction = 'lock'"
        @unlock="confirmAction = 'unlock'"
      />

      <CardOverridePanel
        v-else-if="tab === 'override'"
        v-model:reason="reason"
        v-model:uses="uses"
        v-model:scope-kind="scopeKind"
        v-model:location="location"
        :override-uses="props.overrideUses"
        :override-all-locations="props.overrideAllLocations"
        :location-override-id="props.locationOverrideId"
        :busy="busy"
        @grant="confirmAction = 'override'"
        @clear="confirmAction = 'clearOverride'"
      />

      <CardPromptsPanel
        v-else
        v-model:drafts="drafts"
        v-model:reason="reason"
        :rows="editablePrompts"
        :busy="busy"
        @save="confirmAction = 'prompts'"
      />
    </div>

    <template #footer>
      <div v-if="confirmation" class="flex items-center justify-end gap-3">
        <BaseButton :disabled="busy" @click="confirmAction = null">Back</BaseButton>
        <BaseButton
          :variant="confirmation.tone === 'danger' ? 'danger' : 'primary'"
          :disabled="busy"
          @click="runConfirmedAction"
        >
          {{ busy ? confirmation.busyLabel : confirmation.confirmLabel }}
        </BaseButton>
      </div>
      <div v-else-if="!stepUpFor" class="flex items-center justify-end">
        <BaseButton :disabled="busy" @click="close">Close</BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
