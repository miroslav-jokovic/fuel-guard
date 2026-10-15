<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import {
  AppBadge,
  AppButton,
  AppCallout,
  AppCard,
  AppPageHeader,
  DataTable,
  QueryState,
  useConfirm,
  type DataTableColumn,
} from "@silvicom/ui";
import AppShell from "@/layouts/AppShell.vue";
import { useImpersonationStore } from "@/stores/impersonation";
import { useViewAnomaliesQuery } from "@/lib/queries";
import { fmtDateTime } from "@/lib/format";

/**
 * A read-only support session's view of one customer (US7, D-US11).
 *
 * Two reads, each with its own states: whether a session is open (the grants), then, only while one
 * is, the customer's recent alerts. Before US7 a failed alert read printed a red line ABOVE a table
 * that said "No alerts." — a failure drawn as an answer, the US6b finding the web app closed. Ending
 * the session asks first (D-US7): it is the support person's access, and it does not come back
 * without a new reason on the record.
 */
const route = useRoute();
const router = useRouter();
const id = computed(() => String(route.params.id));
const imp = useImpersonationStore();
const ask = useConfirm();

const grants = useQuery({ queryKey: ["impersonation"], queryFn: async () => (await imp.load(), imp.grants) });
const grant = computed(() => (grants.data.value ? imp.activeForOrg(id.value) : null));
const anomalies = useViewAnomaliesQuery(id, computed(() => grant.value !== null));

const COLUMNS: DataTableColumn[] = [
  { key: "severity", label: "Severity", width: "sm" },
  { key: "status", label: "Status", width: "sm" },
  { key: "message", label: "Alert", cellClass: "text-ink" },
  { key: "createdAt", label: "Raised", cellClass: "text-ink-secondary", width: "md" },
];
const SEV: Record<string, string> = {
  critical: "text-danger-700",
  high: "text-danger-600",
  medium: "text-warning-700",
  low: "text-ink-muted",
};

async function endSession() {
  const g = grant.value;
  if (!g) return;
  const yes = await ask({
    title: "End this support session?",
    message: "Your read-only access to this customer closes now. Opening it again needs a new reason, recorded in their audit trail.",
    confirmLabel: "End session",
    tone: "danger",
  });
  if (!yes) return;
  await imp.revoke(g.id);
  await router.push({ name: "customer", params: { id: id.value } });
}
</script>

<template>
  <!-- ui-adoption: not-a-record — the page answers "is a support session open for this customer?", and
       "No active read-only session" is that answer for an id with no session, including one no customer holds. -->
  <AppShell>
    <QueryState
      :loading="grants.isPending.value"
      :error="grants.error.value"
      error-text="Could not check for a support session."
      :retrying="grants.isFetching.value"
      @retry="() => grants.refetch()"
    >
      <AppCard v-if="!grant">
        <p class="text-sm text-ink">No active read-only session for this customer.</p>
        <AppButton class="mt-3" size="sm" :to="{ name: 'customer', params: { id } }">Back to customer</AppButton>
      </AppCard>
      <template v-else>
        <AppPageHeader title="Read-only customer view" description="Support access is time-limited, read-only, and audited." />
        <AppCallout tone="warning" class="mt-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h2 class="text-sm font-semibold">Support session active</h2>
              <p class="mt-0.5 text-sm">
                Session reason: “{{ grant.reason }}” · expires {{ fmtDateTime(grant.expiresAt) }}. Everything you
                do here is logged in this customer's own audit trail.
              </p>
            </div>
            <AppButton variant="danger" size="sm" @click="endSession">End session</AppButton>
          </div>
        </AppCallout>

        <AppCard padding="none" class="mt-4">
          <h2 class="px-5 pt-5 text-sm font-semibold text-ink-secondary">Recent alerts</h2>
          <DataTable
            class="mt-3"
            embedded
            :columns="COLUMNS"
            :rows="anomalies.data.value ?? []"
            row-key="id"
            :loading="anomalies.isPending.value"
            :error="anomalies.isError.value ? 'Could not load the customer\'s alerts.' : null"
            :retrying="anomalies.isFetching.value"
            empty-text="No alerts."
            @retry="() => anomalies.refetch()"
          >
            <template #cell-severity="{ value }">
              <span class="font-medium capitalize" :class="SEV[value] ?? 'text-ink'">{{ value }}</span>
            </template>
            <template #cell-status="{ value }">
              <AppBadge :tone="value === 'active' ? 'success' : 'neutral'">{{ value }}</AppBadge>
            </template>
            <template #cell-createdAt="{ value }">{{ fmtDateTime(value) }}</template>
          </DataTable>
        </AppCard>
      </template>
    </QueryState>
  </AppShell>
</template>
