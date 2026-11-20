<script setup lang="ts">
import { computed } from "vue";
import { AppCard as BaseCard, DataTable, QueryState, type DataTableColumn } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDateTime } from "@/lib/format";
import AdsTabs from "@/features/ads/AdsTabs.vue";
import { AGENT_LABEL, PLATFORM_LABEL } from "@/features/ads/adsLabels";
import { HEALTH_TONE, agentShare, agentUnits } from "@/features/ads/adsHealthWords";
import { count } from "@/features/ads/spendLines";
import { useAdsHealth } from "@/features/ads/useAdsOverview";
import { useAdsTabs } from "@/features/ads/useAdsTabs";
import AdsStepModes from "@/features/ads/AdsStepModes.vue";

/**
 * Ads › Automation (ADS-PLATFORM-V2-PLAN V8's health page, drawn in V6's workspace; Q-APX18 (a)): is the machinery
 * running, and what is it costing — the connections and their tokens, when Meta last told us of a lead, every ads job
 * over the last week, and every AI agent this month. All of it `GET /api/ads/health`, a read of rows we hold; the
 * shared `adsHealth.ts` says what each figure is and is not ("in shape" means the answer parsed, not that a later
 * check passed it). V5's modes are its first card (`AdsStepModes`): who does each step, and what each mode needs.
 */
const health = useAdsHealth();
const { canOpenSettings } = useAdsTabs();
const view = computed(() => health.data.value);

const jobColumns: DataTableColumn[] = [
  { key: "label", label: "Job" },
  { key: "done", label: "Done", numeric: true },
  { key: "failed", label: "Failed", numeric: true },
  { key: "running", label: "Waiting", numeric: true },
  { key: "last", label: "Last failure" },
];
const agentColumns: DataTableColumn[] = [
  { key: "agent", label: "Agent" },
  { key: "calls", label: "Calls", numeric: true },
  { key: "share", label: "In shape", numeric: true },
  { key: "budget_refused", label: "Refused by budget", numeric: true },
  { key: "units", label: "Used", numeric: true },
];
const agents = computed(() => (view.value?.agents ?? []).map((a) => ({ ...a, label: AGENT_LABEL[a.agent] })));
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Whether the ads machinery is running, and what each part of it is costing this month." />
    <AdsTabs />
    <AdsStepModes :can-open-settings="canOpenSettings" />
    <QueryState
      :loading="health.isLoading.value"
      :error="health.error.value"
      error-text="Could not load the ads health."
      :retrying="health.isFetching.value"
      @retry="health.refetch()"
    >
      <div v-if="view" class="space-y-6">
        <BaseCard as="section" class="space-y-3" data-test="connections">
          <h2 class="text-sm font-semibold text-ink">Connections</h2>
          <p v-if="view.connections.length === 0" class="text-sm text-ink-muted">No ad account is connected.</p>
          <ul v-else class="divide-y divide-edge-subtle">
            <li v-for="c in view.connections" :key="c.id" class="space-y-1 py-3">
              <p class="text-sm font-medium text-ink">
                {{ PLATFORM_LABEL[c.provider as keyof typeof PLATFORM_LABEL] ?? c.provider }}<template v-if="c.is_sandbox"> · sandbox</template>
                <span :class="[BADGE_BASE, toneClass(c.status === 'failing' ? 'danger' : 'success'), 'ml-2']">{{ c.status === "failing" ? "Failing" : "Connected" }}</span>
              </p>
              <p :class="['text-sm', HEALTH_TONE[c.token.tone]]">{{ c.token.words }}</p>
              <p class="text-sm text-ink-muted">
                {{ c.last_test_at ? `Last tested ${formatDateTime(c.last_test_at)}` : "Never tested" }}<template v-if="c.last_error"> · {{ c.last_error }}</template>
              </p>
            </li>
          </ul>
          <p class="text-sm text-ink-muted" data-test="lead-webhook">
            {{ view.lead_webhook.last_at ? `Meta last told us of a lead ${formatDateTime(view.lead_webhook.last_at)}.` : "Meta has not told us of a lead yet." }}
          </p>
        </BaseCard>

        <section class="space-y-2">
          <h2 class="text-sm font-semibold text-ink">Jobs, last 7 days</h2>
          <!-- ui-adoption: unpaged — one row per ads job kind, from the job catalogue. -->
          <DataTable :columns="jobColumns" :rows="view.jobs" row-key="kind" dense empty-text="No ads job kind is registered.">
            <template #cell-label="{ row }"><span :class="HEALTH_TONE[row.tone]">{{ row.label }}</span></template>
            <template #cell-done="{ value }">{{ count(value) }}</template>
            <template #cell-failed="{ value }">{{ count(value) }}</template>
            <template #cell-running="{ value }">{{ count(value) }}</template>
            <template #cell-last="{ row }">
              <template v-if="row.last_failed_at">{{ formatDateTime(row.last_failed_at) }}<span v-if="row.last_error" class="block text-xs text-ink-muted">{{ row.last_error }}</span></template>
              <template v-else>—</template>
            </template>
          </DataTable>
        </section>

        <section class="space-y-2">
          <h2 class="text-sm font-semibold text-ink">AI agents, {{ view.month }}</h2>
          <!-- ui-adoption: unpaged — one row per AI agent, from the contract's agent list. -->
          <DataTable :columns="agentColumns" :rows="agents" row-key="agent" dense empty-text="No AI agent is registered.">
            <template #cell-agent="{ row }">
              {{ row.label }}<span v-if="!row.enabled" class="ml-2 text-xs text-ink-muted">off</span>
              <span v-if="row.failures.length" class="block text-xs text-danger-700">{{ row.failures.map((f: { code: string; count: number }) => `${f.code} × ${f.count}`).join(", ") }}</span>
            </template>
            <template #cell-calls="{ value }">{{ count(value) }}</template>
            <template #cell-share="{ row }">{{ agentShare(row) }}</template>
            <template #cell-budget_refused="{ value }">{{ count(value) }}</template>
            <template #cell-units="{ row }">{{ agentUnits(row) }}</template>
          </DataTable>
        </section>
      </div>
    </QueryState>
  </div>
</template>
