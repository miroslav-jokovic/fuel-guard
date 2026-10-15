<script setup lang="ts">
import { computed, ref } from "vue";
import { AppButton as BaseButton, AppCard as BaseCard, AppFormField as FormField, AppIcon, AppInput as BaseInput } from "@silvicom/ui";
import { CheckCircleIcon, ExclamationTriangleIcon, InformationCircleIcon } from "@silvicom/ui/icons";
import PageHeader from "@/components/ui/PageHeader.vue";
import { QueryState } from "@silvicom/ui";
import { DataTable } from "@silvicom/ui";
import { type DataTableColumn } from "@silvicom/ui";
import JobActionCard from "@/features/jobs/JobActionCard.vue";
import StepUpPrompt from "@/components/StepUpPrompt.vue";
import { useStepUpRetry } from "@/composables/useStepUpRetry";
import { useFleetpalStatus, useSaveFleetpalKey, useSetFleetpalEnabled } from "@/features/settings/useFleetpalConnection";
import { useToastStore } from "@/stores/toast";
import { formatDateTime } from "@/lib/format";

/**
 * FleetPal connection — admin settings page (FLEETPAL-INTEGRATION-PLAN.md §8, 2026-10-04).
 *
 * The collector merged on 2026-09-21 with no way to give it a key, and sat idle for thirteen days
 * behind three switches nobody could see. So this page's first job is to say WHICH switch is off:
 * the org's key, the org's sweep, or the deploy's `FLEETPAL_SYNC_ENABLED` — the last one is not
 * this page's to flip, and the banner names it rather than implying a click here will do.
 */

const status = useFleetpalStatus();
const saveKey = useSaveFleetpalKey();
const setEnabled = useSetFleetpalEnabled();
const toast = useToastStore();
const { stepUpFor, holdForStepUp, confirmed, cancel } = useStepUpRetry();

const apiKey = ref("");
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

async function onSaveKey() {
  keyError.value = apiKey.value.trim().length < 16 ? "Paste the whole key FleetPal showed you." : "";
  if (keyError.value) return;
  try {
    await saveKey.mutateAsync(apiKey.value.trim());
    apiKey.value = ""; // not left in the DOM once stored
    toast.success("FleetPal key saved", "FleetPal accepted it. Switch the sweep on when you are ready.");
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

// D-US4: the per-collection table is a DataTable inside the section's card.
const resourceColumns: DataTableColumn[] = [
  { key: "resource", label: "Collection", cellClass: "font-medium text-ink" },
  { key: "rowsSeen", label: "Rows read", numeric: true },
  { key: "lastRunAt", label: "Last run", cellClass: "text-ink-muted" },
];

function when(at: string | null): string {
  return at ? formatDateTime(at) : "never";
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader>
      FleetPal is the shop's repair record. Once connected, Silvicom 360 reads its work orders, repair
      costs, defects and purchase invoices every hour. It never writes to FleetPal.
    </PageHeader>

    <!-- `state` already folds "no data and not loading" into `error`; the query's own error is passed
         through when there is one, and `true` when the read simply came back empty. -->
    <QueryState
      :loading="state === 'loading'"
      :error="state === 'error' ? (status.error.value ?? true) : null"
      :retrying="status.isFetching.value"
      loading-text="Loading the connection…"
      error-text="Could not load the FleetPal connection."
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
                state === "on" ? "Connected, sweeping every " + (s!.syncHours === 1 ? "hour" : s!.syncHours + " hours")
                : state === "no_key" ? "Not connected"
                : state === "off" ? "Key stored, sweep switched off"
                : "Key stored and switched on, but the server's sweep is off"
              }}
            </h2>
            <p class="mt-1 text-ink-muted">
              <template v-if="state === 'no_key'">Paste an API key from FleetPal below. Nothing is read until you do.</template>
              <template v-else-if="state === 'off'">Switch the sweep on to start reading from FleetPal.</template>
              <template v-else-if="state === 'scheduler_off'">
                The hourly sweep is off for the whole deployment (<code class="text-xs">FLEETPAL_SYNC_ENABLED</code>), which is set
                on the server, not here. <em>Sync now</em> still runs one sweep.
              </template>
              <template v-else>Last sweep finished {{ when(s!.lastSyncedAt) }}.</template>
            </p>
            <p v-if="s!.lastError" class="mt-1 text-caution-700">Last sweep error: {{ s!.lastError.slice(0, 300) }}</p>
          </div>
        </div>
      </BaseCard>

      <BaseCard v-if="stepUpFor" as="section">
        <StepUpPrompt :reason="stepUpFor" @confirmed="confirmed" @cancel="cancel" />
      </BaseCard>

      <BaseCard v-else as="section">
        <h2 class="text-sm font-semibold text-ink">{{ s!.hasKey ? "Replace the API key" : "API key" }}</h2>
        <p class="mt-1 text-xs text-ink-muted">
          FleetPal checks the key before it is saved. It is stored encrypted and never shown again. The key
          reads with the role of the FleetPal user who issued it, so issue it from a user who can see work
          orders and purchasing.
        </p>
        <FormField v-slot="{ id }" class="mt-4" label="FleetPal API key" :error="keyError">
          <BaseInput
            :id="id"
            v-model="apiKey"
            type="password"
            autocomplete="off"
            spellcheck="false"
            :invalid="Boolean(keyError)"
          />
        </FormField>
        <div class="mt-4 flex flex-wrap items-center justify-end gap-2">
          <BaseButton
            v-if="s!.hasKey && s!.enabled"
            variant="secondary"
            :disabled="setEnabled.isPending.value"
            @click="onToggle(false)"
          >
            Switch sweep off
          </BaseButton>
          <BaseButton
            v-if="s!.hasKey && !s!.enabled"
            variant="secondary"
            :disabled="setEnabled.isPending.value"
            @click="onToggle(true)"
          >
            Switch sweep on
          </BaseButton>
          <BaseButton variant="primary" :disabled="saveKey.isPending.value" @click="onSaveKey">
            {{ saveKey.isPending.value ? "Checking with FleetPal…" : "Save key" }}
          </BaseButton>
        </div>
      </BaseCard>

      <JobActionCard
        v-if="s!.hasKey && s!.enabled"
        title="Sweep now"
        kind="fleetpal_sync"
        endpoint="/api/integrations/fleetpal/sync-now"
        action-label="Sync now"
        description="Reads every FleetPal collection that changed since the last sweep. The first sweep reads all history from 01/01/2025 and takes a while."
      />

      <BaseCard v-if="s!.resources.length > 0" as="section">
        <h2 class="text-sm font-semibold text-ink">What each collection last brought in</h2>
        <!-- ui-adoption: never-empty — the card renders only when FleetPal has reported a collection. -->
        <DataTable
          class="mt-3"
          embedded
          dense
          :sticky-header="false"
          :columns="resourceColumns"
          :rows="s!.resources"
          row-key="resource"
        >
          <template #cell-resource="{ row }">
            {{ row.resource }}
            <span v-if="row.lastError" class="block whitespace-normal text-xs font-normal text-caution-700">{{ row.lastError.slice(0, 200) }}</span>
          </template>
          <template #cell-rowsSeen="{ row }">{{ row.rowsSeen.toLocaleString() }}</template>
          <template #cell-lastRunAt="{ row }">{{ when(row.lastRunAt) }}</template>
        </DataTable>
      </BaseCard>
    </QueryState>
  </div>
</template>
