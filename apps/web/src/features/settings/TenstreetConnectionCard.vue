<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { formatDisplayDateTime, TENSTREET_COMPANY_ID_PATTERN, type TenstreetConnectionMode, type TenstreetKeyIssued } from "@silvicom/shared";
import {
  AppButton as BaseButton,
  AppCallout,
  AppFormField as FormField,
  AppInput as BaseInput,
  AppSegmentedControl,
  AppSwitch,
  QueryState,
  useConfirm,
} from "@silvicom/ui";
import StepUpPrompt from "@/components/StepUpPrompt.vue";
import { useStepUpRetry } from "@/composables/useStepUpRetry";
import { useRotateTenstreetKey, useSaveTenstreetConnection, useTenstreetConnection } from "@/features/settings/useTenstreetConnection";
import { useToastStore } from "@/stores/toast";

/**
 * Settings › Recruiting › Tenstreet (TENSTREET-INTAKE-PLAN TS4). Where a carrier sets up Tenstreet's push of
 * applications into Recruitment › Leads: Tenstreet's Company ID, TEST or PROD, the address Tenstreet posts to, and
 * the switch. Built like Med-Stop's card (`MedstopOrderingCard`): a fresh sign-in before switching on or making an
 * address, never before switching off.
 *
 * ── THE ADDRESS IS SHOWN ONCE ───────────────────────────────────────────────────────────────────
 * Its secret is stored as a fingerprint, so after this card shows it there is no way to show it again — the same
 * promise, in the same words, as an application link (`ApplicationLinkOnce`). Lost, a new one is made, and the old
 * one stops working the moment it is (asked before it happens). D-TS7: it goes to Tenstreet by phone, not e-mail.
 *
 * ── WHAT THE LAST SEVEN DAYS SAY ────────────────────────────────────────────────────────────────
 * Read from the post log: posts accepted, posts refused (nothing kept), posts accepted that could not become a lead.
 * The last problem is the newest of the last two kinds, with the sentence Tenstreet was given.
 */
const status = useTenstreetConnection();
const save = useSaveTenstreetConnection();
const rotate = useRotateTenstreetKey();
const toast = useToastStore();
const ask = useConfirm();
const { stepUpFor, holdForStepUp, confirmed, cancel } = useStepUpRetry();

const MODES: Array<{ value: TenstreetConnectionMode; label: string }> = [
  { value: "test", label: "Test" },
  { value: "prod", label: "Production" },
];

const companyId = ref("");
const mode = ref<TenstreetConnectionMode>("test");
const error = ref("");
const issued = ref<TenstreetKeyIssued | null>(null);

watch(
  () => status.data.value,
  (s) => {
    if (!s) return;
    companyId.value = s.companyId ?? "";
    mode.value = s.mode;
  },
  { immediate: true },
);

const s = computed(() => status.data.value);
const pickMode = (v: string): void => {
  const picked = MODES.find((m) => m.value === v);
  if (picked) mode.value = picked.value;
};
const busy = computed(() => save.isPending.value || rotate.isPending.value);

async function submit(enabled: boolean): Promise<void> {
  const id = companyId.value.trim();
  error.value = TENSTREET_COMPANY_ID_PATTERN.test(id) ? "" : "Enter Tenstreet's Company ID — digits only.";
  if (error.value) return;
  try {
    await save.mutateAsync({ companyId: id, mode: mode.value, enabled });
    const was = s.value?.enabled ?? false;
    toast.success(enabled && !was ? "Tenstreet switched on" : !enabled && was ? "Tenstreet switched off" : "Tenstreet settings saved");
  } catch (e) {
    if (holdForStepUp(e, () => submit(enabled))) return;
    error.value = e instanceof Error ? e.message : "Could not save";
  }
}

async function makeAddress(): Promise<void> {
  if (s.value?.keyHint) {
    const yes = await ask({
      title: "Make a new address?",
      message: "The address Tenstreet has now stops working at once. Applications Tenstreet sends before you give it the new one are refused, and Tenstreet sends them again later.",
      confirmLabel: "Make a new address",
      tone: "danger",
    });
    if (!yes) return;
  }
  await doRotate();
}

async function doRotate(): Promise<void> {
  try {
    issued.value = await rotate.mutateAsync();
  } catch (e) {
    if (holdForStepUp(e, doRotate)) return;
    toast.error("Could not make the address", e instanceof Error ? e.message : undefined);
  }
}

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Address copied");
  } catch {
    // Clipboard access is refused in some browsers and contexts; the address is on screen either way.
    toast.error("Could not copy", "Select the address and copy it manually.");
  }
}

const weekLine = computed(() => {
  const w = s.value?.last7Days;
  if (!w) return "";
  return `Last 7 days: ${w.accepted} accepted, ${w.rejected} refused, ${w.failed} could not become a lead.`;
});
const lastPostLine = computed(() =>
  s.value?.lastPostAt ? `Last application accepted ${formatDisplayDateTime(s.value.lastPostAt)}.` : "No application has been accepted yet.",
);
const problemLine = computed(() => {
  const p = s.value?.lastProblem;
  if (!p) return null;
  const what = p.kind === "rejected" ? "A post was refused" : "An accepted post could not become a lead";
  return `${what} ${formatDisplayDateTime(p.at)}: ${p.text}`;
});
</script>

<template>
  <QueryState
    :loading="status.isLoading.value"
    :error="status.isError.value ? status.error.value : null"
    :retrying="status.isFetching.value"
    loading-text="Loading the Tenstreet connection…"
    error-text="Could not load the Tenstreet connection."
    @retry="status.refetch()"
  >
    <div v-if="stepUpFor">
      <StepUpPrompt :reason="stepUpFor" @confirmed="confirmed" @cancel="cancel" />
    </div>
    <div v-else-if="s" class="space-y-4">
      <AppCallout v-if="!s.receiverReady" tone="warning">
        This server cannot keep applications yet (its encryption key is not set), so it asks Tenstreet to send every
        one again later. Nothing is lost, but nothing arrives until the key is set.
      </AppCallout>

      <div class="grid gap-4 sm:grid-cols-2">
        <FormField v-slot="{ id }" label="Tenstreet Company ID" :error="error">
          <BaseInput :id="id" v-model="companyId" inputmode="numeric" autocomplete="off" :invalid="Boolean(error)" />
        </FormField>
        <FormField label="Tenstreet sends">
          <AppSegmentedControl :model-value="mode" :options="MODES" label="Tenstreet sends" @update:model-value="pickMode" />
        </FormField>
      </div>
      <p class="text-xs text-ink-muted">
        Test takes only Tenstreet's test applications; Production takes only real ones. Each refuses the other.
      </p>
      <div class="flex justify-end">
        <BaseButton :disabled="busy" @click="submit(s.enabled)">Save</BaseButton>
      </div>

      <div v-if="s.configured" class="space-y-3 border-t border-edge pt-4">
        <h3 class="text-sm font-semibold text-ink">The address Tenstreet sends applications to</h3>

        <div v-if="issued" class="rounded-surface bg-surface-muted p-3">
          <p class="text-xs font-medium text-ink-secondary">Read this address to Tenstreet by phone</p>
          <p class="mt-1 break-all font-mono text-xs text-ink">{{ issued.endpoint ?? issued.key }}</p>
          <p v-if="!issued.endpoint" class="mt-1 text-xs text-ink-muted">
            This server's public address is not set, so only the key is shown. It goes after /api/webhooks/tenstreet/ on the
            API's address.
          </p>
          <div class="mt-3 flex items-center gap-3">
            <BaseButton size="sm" @click="copy(issued.endpoint ?? issued.key)">Copy the address</BaseButton>
            <p class="text-xs text-ink-muted">
              It is shown once here. We keep only a fingerprint of it, so it cannot be shown again — make a new one if it is lost.
            </p>
          </div>
        </div>
        <template v-else-if="s.keyHint">
          <p class="break-all font-mono text-xs text-ink">
            {{ s.endpointMasked ?? `…/api/webhooks/tenstreet/••••${s.keyHint}` }}
          </p>
          <p class="text-xs text-ink-muted">
            Made {{ s.rotatedAt ? formatDisplayDateTime(s.rotatedAt) : "earlier" }}. Only its last four characters are kept on screen.
          </p>
        </template>
        <p v-else class="text-xs text-ink-muted">No address yet. Make one, then give it to Tenstreet.</p>

        <div class="flex justify-end">
          <BaseButton :variant="s.keyHint ? 'secondary' : 'primary'" :disabled="busy" @click="makeAddress">
            {{ s.keyHint ? "Make a new address" : "Make the address" }}
          </BaseButton>
        </div>
      </div>

      <div v-if="s.configured" class="space-y-2 border-t border-edge pt-4">
        <AppSwitch
          :model-value="s.enabled"
          label="Take applications from Tenstreet"
          :disabled="busy || !s.keyHint"
          @update:model-value="(on: boolean) => submit(on)"
        />
        <p class="text-sm text-ink">{{ s.enabled ? "On — Tenstreet's applications become leads." : "Off — Tenstreet's posts are refused." }}</p>
        <p class="text-xs text-ink-muted">{{ lastPostLine }} {{ weekLine }}</p>
        <AppCallout v-if="problemLine" :tone="s.lastProblem?.kind === 'failed' ? 'danger' : 'caution'">{{ problemLine }}</AppCallout>
      </div>
    </div>
  </QueryState>
</template>
