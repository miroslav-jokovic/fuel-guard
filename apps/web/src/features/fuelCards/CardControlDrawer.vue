<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type { CardCapabilities, EfsLocation, PromptInput, WsCard } from "@fuelguard/shared";
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
 * Every way this product can change a fuel card.
 *
 * ── The four properties this drawer exists to keep ───────────────────────────────────────────────
 *
 * 1. **It sends the version the screen was DRAWN from.** If the card moved in the WEX portal since,
 *    the API answers 409 and the operator is shown the new truth instead of silently overwriting it.
 *
 * 2. **One idempotency key per action, RE-MINTED after every settled outcome** (audit P1-2). Reused
 *    across retries of the same in-flight attempt — a double-click cannot grant two overrides — but
 *    a new key after success/failure/drift, so a genuine SECOND attempt from the still-open drawer
 *    is a new request rather than a replay of the first. The one exception is `sent`: an unconfirmed
 *    write keeps its key, because re-clicking it must replay "still unconfirmed", never risk a
 *    second apply.
 *
 * 3. **A 200 is not a success.** The API answers 200 for every recorded outcome, including "EFS
 *    refused" and "we could not confirm". `outcomeNotice` decides which the operator hears, and an
 *    `idempotent` replay is called out as matching an earlier attempt rather than dressed up as new.
 *
 * 4. **State is keyed on the CARD, not just the drawer being open** (audit finding, web #2). A drawer
 *    that stays mounted while the card changes underneath it re-seeds everything — keys, drafts,
 *    inputs — so an action can never carry card A's key or draft to card B.
 *
 * ── Layout ───────────────────────────────────────────────────────────────────────────────────────
 * Each section (Lock, Exception, Prompts) is STACKED with its own action button, the dashboard's
 * pattern — not tabs. One in-flight action disables only its own section; the shared confirmation
 * step then replaces the body for the single decision that needs confirming.
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
  prompts: { infoId: string; validationType: string | null; matchValue: string | null; reportValue: string | null }[];
  capabilities: CardCapabilities;
}>();

const emit = defineEmits<{ close: []; changed: [] }>();

const toast = useToastStore();

type ConfirmAction = "lock" | "unlock" | "override" | "clearOverride" | "prompts";

const confirmAction = ref<ConfirmAction | null>(null);
/** Set when the API asks for a fresh sign-in; the prompt replaces the body, like a confirmation. */
const stepUpFor = ref<ConfirmAction | null>(null);
/** The message + max-age the SERVER asked step-up for, so the prompt says why (web finding #4). */
const stepUpReason = ref<string>("This action needs a recent sign-in.");

const lockStatus = ref<"Hold" | "Inactive">("Hold");
const uses = ref(1);
const scopeKind = ref<"all" | "location">("all");
const location = ref<EfsLocation | null>(null);
const drafts = ref<PromptInput[]>([]);
const activeVersion = ref(props.version);
const activeStatus = ref(props.status);
const activePrompts = ref(props.prompts);
/** Set after a 409 so a stale parent refetch cannot overwrite the live document in the drawer. */
const recoveredVersion = ref<string | null>(null);
const recoveredCardId = ref<string | null>(null);

/** One key per action, re-minted at every settled outcome (see property 2). */
const keys = reactive<Record<ConfirmAction, string>>({
  lock: "", unlock: "", override: "", clearOverride: "", prompts: "",
});
const rotate = (action: ConfirmAction): void => { keys[action] = newIdempotencyKey(); };

const lock = useLockCard();
const unlock = useUnlockCard();
const grant = useGrantOverride();
const clear = useClearOverride();
const setPrompts = useSetPrompts();

/** Per-action pending, so one in-flight section does not freeze the others. */
const pendingFor = ref<ConfirmAction | null>(null);
const busy = computed(() => pendingFor.value !== null);
const sectionBusy = (action: ConfirmAction): boolean => pendingFor.value === action;

const editablePrompts = computed(() =>
  activePrompts.value.map((p) => ({ ...p, editable: (EFS_EDITABLE_INFO_IDS as readonly string[]).includes(p.infoId) })),
);

function seedDrawer(
  version: string,
  status: string | null,
  prompts: readonly { infoId: string; validationType: string | null; matchValue: string | null; reportValue: string | null }[],
): void {
  activeVersion.value = version;
  activeStatus.value = status ?? props.status;
  activePrompts.value = [...prompts];
  confirmAction.value = null;
  stepUpFor.value = null;
  lockStatus.value = "Hold";
  uses.value = 1;
  scopeKind.value = "all";
  location.value = null;
  for (const action of Object.keys(keys) as ConfirmAction[]) rotate(action);
  // Only the editable prompts become drafts. Everything else is echoed untouched by the API.
  drafts.value = prompts
    .filter((p) => (EFS_EDITABLE_INFO_IDS as readonly string[]).includes(p.infoId))
    .map((p) => ({
      infoId: p.infoId as PromptInput["infoId"],
      validationType: p.validationType === "REPORT_ONLY" ? "REPORT_ONLY" : "EXACT_MATCH",
      matchValue: p.matchValue,
      reportValue: p.reportValue,
      remove: false,
    }));
}

/** The 409 payload is the fresh document the API just read, not a mirror row. */
function isLiveCard(value: unknown): value is Pick<WsCard, "status" | "infos"> {
  return typeof value === "object" && value !== null && Array.isArray((value as { infos?: unknown }).infos);
}

/**
 * Seed everything from the current card — on OPEN and on any change to the card identity or the
 * version/prompts it was drawn from. A stale parent refetch cannot replace a newer live 409 payload.
 */
watch(
  () => [props.open, props.cardId, props.version, props.prompts] as const,
  ([open]) => {
    if (!open) return;
    if (recoveredCardId.value === props.cardId && recoveredVersion.value !== null && recoveredVersion.value !== props.version) return;
    recoveredCardId.value = null;
    recoveredVersion.value = null;
    seedDrawer(props.version, props.status, props.prompts);
  },
  { immediate: true },
);

const removesPrompt = computed(() => drafts.value.some((draft) => draft.remove));
const removesDriverId = computed(() => drafts.value.some((draft) => draft.infoId === "DRID" && draft.remove));

const locationLabel = computed(() =>
  location.value
    ? [location.value.name, location.value.city, location.value.state].filter(Boolean).join(", ")
    : null,
);

const confirmation = computed<CardConfirmation | null>(() => {
  switch (confirmAction.value) {
    case "lock": return lockConfirmation(lockStatus.value);
    case "unlock": return unlockConfirmation(efsStatusEquals(activeStatus.value, "Fraud"));
    case "override": return overrideConfirmation(uses.value, scopeKind.value === "location" ? locationLabel.value : null);
    case "clearOverride": return clearOverrideConfirmation();
    case "prompts": return promptsConfirmation(removesDriverId.value);
    default: return null;
  }
});

const sections = computed(() =>
  [
    { key: "status" as const, show: props.capabilities.canLock || props.capabilities.canUnlock },
    { key: "override" as const, show: props.capabilities.canOverride },
    { key: "prompts" as const, show: props.capabilities.canSetPrompts },
  ].filter((s) => s.show),
);
const showSection = (key: "status" | "override" | "prompts"): boolean =>
  sections.value.some((s) => s.key === key);

const common = () => ({ cardId: props.cardId, expectedVersion: activeVersion.value });

async function runConfirmedAction(): Promise<void> {
  const action = confirmAction.value;
  if (!action || busy.value) return; // re-entrancy guard (web finding #5)
  const copy = confirmation.value!;
  pendingFor.value = action;
  try {
    const outcome = await dispatch(action);
    const notice = outcomeNotice(outcome, copy.doneLabel);
    if (notice.kind === "success") toast.success(notice.title, notice.message);
    else if (notice.kind === "warning") toast.warning(notice.title, notice.message);
    else toast.error(notice.title, notice.message);
    confirmAction.value = null;
    emit("changed");
    // A key is spent the moment its request SETTLES with a known outcome — a retry from here must be
    // a new request. `sent` is the sole exception: its outcome is unknown, and re-clicking it must
    // replay "still unconfirmed", never chance a second apply.
    if (outcome.status !== "sent") rotate(action);
    // Only a clean success closes the drawer. Anything else leaves the operator where they can read
    // the card's new state and decide what to do about it.
    if (notice.kind === "success") emit("close");
  } catch (error) {
    handleFailure(action, error);
  } finally {
    pendingFor.value = null;
  }
}

function dispatch(action: ConfirmAction): Promise<CardMutationOutcome> {
  switch (action) {
    case "lock":
      return lock.mutateAsync({ ...common(), idempotencyKey: keys.lock, status: lockStatus.value });
    case "unlock":
      return unlock.mutateAsync({ ...common(), idempotencyKey: keys.unlock });
    case "override":
      return grant.mutateAsync({
        ...common(), idempotencyKey: keys.override, uses: uses.value,
        scope: scopeKind.value === "all" ? { kind: "all" } : { kind: "location", locationId: location.value!.locId },
      });
    case "clearOverride":
      return clear.mutateAsync({ ...common(), idempotencyKey: keys.clearOverride });
    case "prompts":
      return setPrompts.mutateAsync({
        ...common(), idempotencyKey: keys.prompts,
        // Removal is explicit on the draft; empty match/report values are valid prompt values.
        prompts: drafts.value,
        allowRemoveDriverId: removesPrompt.value,
      });
  }
}

/**
 * Outcomes that are not really the end.
 *
 * Each recoverable refusal gets its own specific response and, where the server sent one, its own
 * words. A key is NOT rotated here: none of these opened a ledger row, so the same key is still the
 * right one for the retry the operator is about to make.
 */
function handleFailure(action: ConfirmAction, error: unknown): void {
  const api = error instanceof CardControlApiError ? error : null;

  if (api?.code === "step_up_required") {
    stepUpFor.value = action;
    stepUpReason.value = api.message || "This action needs a recent sign-in.";
    confirmAction.value = null;
    return;
  }
  if (api?.code === "card_state_changed") {
    const currentVersion = api.detail.currentVersion;
    const currentCard = api.detail.card;
    if (typeof currentVersion === "string" && isLiveCard(currentCard)) {
      recoveredCardId.value = props.cardId;
      recoveredVersion.value = currentVersion;
      seedDrawer(currentVersion, currentCard.status, currentCard.infos);
    } else {
      confirmAction.value = null;
    }
    // The API just read this live document. Keep it in the drawer immediately; the parent refetch is
    // still emitted to repair the mirror, but it must not be the source of recovery state.
    emit("changed");
    toast.error("Card changed in EFS", "The current settings are loaded — review and try again.");
    return;
  }
  if (api?.code === "mutation_in_flight") {
    confirmAction.value = null;
    toast.error("Still confirming an earlier change", "Wait for it to finish, then try again.");
    return;
  }
  if (api?.code === "idempotency_key_reused") {
    // Defence in depth for property 4: the client already re-seeds on card change, so this should
    // not happen — but if it does, a fresh key makes the retry clean rather than stuck.
    rotate(action);
    confirmAction.value = null;
    toast.error("Please try that again", "The previous request could not be matched; a fresh attempt is ready.");
    return;
  }
  if (api?.status === 429) {
    confirmAction.value = null;
    const retryAfter = typeof api.detail.retryAfterSec === "number" ? ` Try again in about ${api.detail.retryAfterSec}s.` : "";
    toast.error("Too many card changes just now", `This limit protects the account.${retryAfter}`);
    return;
  }
  if (api?.code === "card_control_disabled" || api?.code === "card_control_not_entitled" || api?.status === 403) {
    confirmAction.value = null;
    emit("changed"); // capabilities may have changed under the operator; refetch closes the tabs
    toast.error("Card actions are not available", api?.message);
    return;
  }
  toast.error("Could not change the card", error instanceof Error ? error.message : undefined);
}

/** The step-up prompt succeeded: a fresh step-up token is held now, so re-run the action. */
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
      :reason="stepUpReason"
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
    </div>

    <!-- Stacked sections, each with its own action button (dashboard pattern, B2). -->
    <div v-else class="space-y-8">
      <CardStatusPanel
        v-if="showSection('status')"
        v-model:lock-status="lockStatus"
        :status="activeStatus"
        :last-used-date="props.lastUsedDate"
        :driver-name="props.driverName"
        :unit-prompt="props.unitPrompt"
        :can-lock="props.capabilities.canLock"
        :can-unlock="props.capabilities.canUnlock"
        :busy="sectionBusy('lock') || sectionBusy('unlock')"
        @lock="confirmAction = 'lock'"
        @unlock="confirmAction = 'unlock'"
      />

      <CardOverridePanel
        v-if="showSection('override')"
        v-model:uses="uses"
        v-model:scope-kind="scopeKind"
        v-model:location="location"
        :override-uses="props.overrideUses"
        :override-all-locations="props.overrideAllLocations"
        :location-override-id="props.locationOverrideId"
        :busy="sectionBusy('override') || sectionBusy('clearOverride')"
        @grant="confirmAction = 'override'"
        @clear="confirmAction = 'clearOverride'"
      />

      <CardPromptsPanel
        v-if="showSection('prompts')"
        v-model:drafts="drafts"
        :rows="editablePrompts"
        :busy="sectionBusy('prompts')"
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
