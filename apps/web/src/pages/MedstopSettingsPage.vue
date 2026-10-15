<script setup lang="ts">
import { computed, ref } from "vue";
import { AppButton as BaseButton, AppCard as BaseCard, AppDateField, AppFormField as FormField, AppIcon, AppInput as BaseInput } from "@silvicom/ui";
import { CheckCircleIcon, ExclamationTriangleIcon, InformationCircleIcon } from "@silvicom/ui/icons";
import { MEDSTOP_KEY_NOTICE_DAYS, shiftDay, todayInZone, DEFAULT_ORG_TIMEZONE } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import QueryState from "@/components/ui/QueryState.vue";
import JobActionCard from "@/features/jobs/JobActionCard.vue";
import MedstopOrderingCard from "@/features/settings/MedstopOrderingCard.vue";
import StepUpPrompt from "@/components/StepUpPrompt.vue";
import { useStepUpRetry } from "@/composables/useStepUpRetry";
import { useMedstopStatus, useSaveMedstopKey, useSetMedstopEnabled } from "@/features/settings/useMedstopConnection";
import { useToastStore } from "@/stores/toast";
import { formatDate, formatDateTime } from "@/lib/format";

/**
 * Med-Stop connection — admin settings page (MEDSTOP-PLAN.md §6, MS1). FleetPal's page in shape, for
 * FleetPal's lesson: say WHICH switch is off (the key, the org's sweep, or the deploy's
 * `MEDSTOP_SYNC_ENABLED`). One thing FleetPal lacks: Med-Stop keys die after at most 180 days and a
 * dead key answers exactly like a wrong one, so the page carries the expiry and warns 30 days ahead.
 */

const status = useMedstopStatus();
const saveKey = useSaveMedstopKey();
const setEnabled = useSetMedstopEnabled();
const toast = useToastStore();
const { stepUpFor, holdForStepUp, confirmed, cancel } = useStepUpRetry();

const apiKey = ref("");
const expiresOn = ref("");
const keyError = ref("");

const s = computed(() => status.data.value);
const state = computed<"loading" | "error" | "no_key" | "off" | "scheduler_off" | "on">(() => {
  if (status.isLoading.value && !s.value) return "loading";
  if (!s.value) return "error";
  if (!s.value.hasKey) return "no_key";
  if (!s.value.enabled) return "off";
  if (!s.value.schedulerOn) return "scheduler_off";
  return "on";
});

const today = todayInZone(new Date(), DEFAULT_ORG_TIMEZONE);
const expiry = computed<"none" | "expired" | "soon" | "ok">(() => {
  const on = s.value?.keyExpiresOn;
  if (!on) return "none";
  if (on < today) return "expired";
  // The admins' first notice comes on the same day (D-MSUX21), so the page and the bell agree on "soon".
  return on <= shiftDay(today, MEDSTOP_KEY_NOTICE_DAYS[0]) ? "soon" : "ok";
});

async function onSaveKey() {
  keyError.value = apiKey.value.trim().length < 16 ? "Paste the whole key Med-Stop showed you." : "";
  if (keyError.value) return;
  try {
    await saveKey.mutateAsync({ apiKey: apiKey.value.trim(), expiresOn: expiresOn.value || null });
    apiKey.value = "";
    toast.success("Med-Stop key saved", "Med-Stop accepted it from this server. Switch the sweep on when you are ready.");
  } catch (e) {
    if (holdForStepUp(e, onSaveKey)) return;
    keyError.value = e instanceof Error ? e.message : "Could not save the key";
  }
}

async function onToggle(enabled: boolean) {
  try {
    await setEnabled.mutateAsync(enabled);
    toast.info(enabled ? "Sweep switched on" : "Sweep switched off");
  } catch (e) {
    if (holdForStepUp(e, () => onToggle(enabled))) return;
    toast.error("Could not change the sweep", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader>
      Med-Stop runs the company's DOT drug and alcohol program: the random pools, the selections, and
      every test. Once connected, Silvicom 360 reads its roster and random pools every hour and shows
      the results on Safety › Drug &amp; Alcohol. It orders a test only when ordering is switched on below,
      and changes nothing else in Med-Stop.
    </PageHeader>

    <QueryState
      :loading="state === 'loading'"
      :error="state === 'error' ? (status.error.value ?? true) : null"
      :retrying="status.isFetching.value"
      loading-text="Loading the connection…"
      error-text="Could not load the Med-Stop connection."
      @retry="status.refetch()"
    >
      <BaseCard>
        <div class="flex items-start gap-3">
          <AppIcon
            :icon="state === 'on' ? CheckCircleIcon : state === 'no_key' ? InformationCircleIcon : ExclamationTriangleIcon"
            class="size-6 shrink-0"
            :class="state === 'on' ? 'text-success-500' : state === 'no_key' ? 'text-brand-500' : 'text-caution-500'"
          />
          <div class="min-w-0 text-sm">
            <h2 class="text-sm font-semibold text-ink">
              {{
                state === "on" ? "Connected, reading every " + (s!.syncHours === 1 ? "hour" : s!.syncHours + " hours")
                : state === "no_key" ? "Not connected"
                : state === "off" ? "Key stored, sweep switched off"
                : "Key stored and switched on, but the server's sweep is off"
              }}
            </h2>
            <p class="mt-1 text-ink-muted">
              <template v-if="state === 'no_key'">Paste an API key from Med-Stop API Admin below. Nothing is read until you do.</template>
              <template v-else-if="state === 'off'">Switch the sweep on to start reading from Med-Stop.</template>
              <template v-else-if="state === 'scheduler_off'">
                The hourly sweep is off for the whole deployment (<code class="text-xs">MEDSTOP_SYNC_ENABLED</code>), which is set
                on the server, not here. <em>Sync now</em> still runs one sweep.
              </template>
              <template v-else>Last sweep finished {{ s!.lastSyncedAt ? formatDateTime(s!.lastSyncedAt) : "never" }}.</template>
            </p>
            <p v-if="s!.lastError" class="mt-1 text-caution-700">Last sweep error: {{ s!.lastError.slice(0, 300) }}</p>
            <p v-if="expiry === 'expired'" class="mt-1 text-danger-700">
              The key expired on {{ formatDate(s!.keyExpiresOn!) }}. Create a new one in Med-Stop API Admin and paste it below.
            </p>
            <p v-else-if="expiry === 'soon'" class="mt-1 text-caution-700">
              The key expires on {{ formatDate(s!.keyExpiresOn!) }}. Rotate it in Med-Stop API Admin before then.
            </p>
            <p v-else-if="expiry === 'ok'" class="mt-1 text-ink-muted">Key expires {{ formatDate(s!.keyExpiresOn!) }}.</p>
          </div>
        </div>
      </BaseCard>

      <BaseCard v-if="stepUpFor" as="section">
        <StepUpPrompt :reason="stepUpFor" @confirmed="confirmed" @cancel="cancel" />
      </BaseCard>

      <BaseCard v-else as="section">
        <h2 class="text-sm font-semibold text-ink">{{ s!.hasKey ? "Replace the API key" : "API key" }}</h2>
        <p class="mt-1 text-xs text-ink-muted">
          This server checks the key with Med-Stop before saving it, so the key's IP filter must include the
          API service's addresses. It is stored encrypted and never shown again. Med-Stop keys last at most
          180 days; enter the expiry Med-Stop API Admin shows so this page can remind you.
        </p>
        <div class="mt-4 grid gap-4 sm:grid-cols-[1fr_12rem]">
          <FormField v-slot="{ id }" label="Med-Stop API key" :error="keyError">
            <BaseInput :id="id" v-model="apiKey" type="password" autocomplete="off" spellcheck="false" :invalid="Boolean(keyError)" />
          </FormField>
          <FormField v-slot="{ id }" label="Key expires">
            <AppDateField :id="id" v-model="expiresOn" />
          </FormField>
        </div>
        <div class="mt-4 flex flex-wrap items-center justify-end gap-2">
          <BaseButton v-if="s!.hasKey && s!.enabled" variant="secondary" :disabled="setEnabled.isPending.value" @click="onToggle(false)">
            Switch sweep off
          </BaseButton>
          <BaseButton v-if="s!.hasKey && !s!.enabled" variant="secondary" :disabled="setEnabled.isPending.value" @click="onToggle(true)">
            Switch sweep on
          </BaseButton>
          <BaseButton variant="primary" :disabled="saveKey.isPending.value" @click="onSaveKey">
            {{ saveKey.isPending.value ? "Checking with Med-Stop…" : "Save key" }}
          </BaseButton>
        </div>
      </BaseCard>

      <MedstopOrderingCard v-if="!stepUpFor && s!.hasKey" :status="s!" />

      <JobActionCard
        v-if="s!.hasKey && s!.enabled"
        title="Sweep now"
        kind="medstop_sync"
        endpoint="/api/integrations/medstop/sync-now"
        action-label="Sync now"
        description="Reads Med-Stop's employee roster, random pools and selections, and matches them to the drivers here. About 25 requests; under a minute."
      />
    </QueryState>
  </div>
</template>
