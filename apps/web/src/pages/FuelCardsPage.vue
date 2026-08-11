<script setup lang="ts">
/**
 * The fuel-card inventory, as EFS reports it.
 *
 * New surface: until now FuelGuard has only ever INFERRED card state from fill history
 * (learnCardAssignments), so "is this card locked?" had no answer. These rows come from the vendor.
 */
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import BaseButton from "@/components/ui/BaseButton.vue";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import TablePagination from "@/components/TablePagination.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useToastStore } from "@/stores/toast";
import { cardStatusLabel, cardStatusTone, freshness } from "@/features/fuelCards/cardControlModel";
import { useJob } from "@/features/jobs/useJob";
import { useEfsCards, useSyncEfsCards, type EfsCardRow } from "@/features/fuelCards/useEfsCards";

const PAGE_SIZE = 20;

const router = useRouter();
const toast = useToastStore();

const search = ref("");
const status = ref("");
const page = ref(1);

const query = useEfsCards({ search, status });
const sync = useSyncEfsCards();

/**
 * The sweep runs in the background, so the button alone tells you nothing. This is what turns
 * "I pressed refresh and nothing happened" into an answer: the ledger row carries the outcome, and
 * a sweep that found nothing is a DIFFERENT fact from one that never ran.
 */
const syncJob = useJob("efs_card_sync");

const syncOutcome = computed((): { tone: string; text: string; at?: string } | null => {
  if (syncJob.isRunning.value) return { tone: "info", text: "Reading the card list from EFS…" };
  const job = syncJob.latest.value;
  if (!job) return null;
  const at = job.finished_at ? new Date(job.finished_at).toLocaleString() : undefined;
  if (job.status === "failed") {
    // EFS answers "Not Allowed <ref>" when it refuses an operation. Deliberately does NOT name a
    // cause: we have seen this mean an IP allowlist (per the vendor), an entitlement gap, and a
    // malformed request body, and we could not tell them apart from this message alone. Report the
    // observation and point at the diagnostic that CAN tell them apart, rather than sending somebody
    // to their firewall vendor on a guess.
    if (/not\s*allowed/i.test(job.error ?? "")) {
      return {
        tone: "warning",
        text: "EFS refused the card operations for this account. Transaction feeds are still working, so the credentials are fine. An admin can run the card diagnostic to see exactly which operations are refused before raising it with WEX.",
      };
    }
    return { at, tone: "danger", text: `EFS refresh failed: ${job.error ?? "no reason reported"}` };
  }
  const stats = job.stats as { cardsSeen?: number; upserted?: number; detailed?: number; failed?: number; errors?: string[]; reason?: string };
  // The handler answers `skipped` when EFS is not connected — an ordinary state, not an error, but
  // one nobody can act on unless it is said out loud.
  if (stats?.reason === "efs_soap_disabled") {
    return { at, tone: "warning", text: "EFS is not connected for this company, so there is nothing to read yet." };
  }
  if ((stats?.failed ?? 0) > 0 && (stats?.upserted ?? 0) === 0) {
    return { at, tone: "danger", text: `EFS refresh could not store any cards: ${stats?.errors?.[0] ?? "see the API log"}` };
  }
  if ((stats?.cardsSeen ?? 0) === 0) {
    return { at, tone: "warning", text: "EFS returned no cards for this account. Check that the service account can see this fleet's cards." };
  }
  return null;
});

watch([search, status], () => { page.value = 1; });

const rows = computed(() => query.data.value?.cards ?? []);
const paged = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

/** Oldest row wins: the banner should reflect the least fresh thing on screen, not the average. */
const oldestSync = computed(() => {
  const times = rows.value.map((r) => r.syncedAt).filter(Boolean).sort();
  return times[0] ?? null;
});
const listFreshness = computed(() => freshness(oldestSync.value, new Date(), query.data.value?.staleAfterMinutes));

const columns: DataTableColumn[] = [
  { key: "maskedRef", label: "Card", headerClass: "min-w-[8rem]", cellClass: "font-medium text-ink" },
  { key: "status", label: "Status", headerClass: "min-w-[7rem]" },
  { key: "unitPrompt", label: "Unit", headerClass: "min-w-[6rem]" },
  { key: "driverIdPrompt", label: "Driver ID", headerClass: "min-w-[8rem]" },
  { key: "policyNumber", label: "Policy", numeric: true, headerClass: "min-w-[5rem]" },
  { key: "overrideUses", label: "Override", headerClass: "min-w-[6rem]" },
];

const chips = computed(() =>
  status.value ? [{ key: "status", label: "Status", value: cardStatusLabel(status.value) }] : [],
);

function onRemoveChip(key: string): void {
  if (key === "status") status.value = "";
}

async function onSync(): Promise<void> {
  try {
    await sync.mutateAsync();
    toast.success("Refresh started");
    // The ledger row appears as soon as the job is enqueued; markRunning shows it without a poll wait.
    syncJob.markRunning();
    void syncJob.refresh();
  } catch (e) {
    toast.error("Could not start the refresh", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Every EFS card on this account, with the settings EFS currently reports.">
      <template #actions>
        <BaseButton variant="secondary" :disabled="sync.isPending.value || syncJob.isRunning.value" @click="onSync">
          {{ sync.isPending.value || syncJob.isRunning.value ? "Refreshing…" : "Refresh from EFS" }}
        </BaseButton>
      </template>
    </PageHeader>

    <p v-if="syncOutcome" class="text-sm" :class="syncOutcome.tone === 'danger' ? 'text-danger-700' : syncOutcome.tone === 'warning' ? 'text-caution-700' : 'text-ink-muted'">
      {{ syncOutcome.text }}
      <!-- The banner reflects the LAST run, which can easily predate a deploy that was meant to fix
           it. Without the timestamp, a stale failure reads as a current one. -->
      <span v-if="syncOutcome.at" class="text-ink-muted">(last checked {{ syncOutcome.at }})</span>
    </p>

    <p v-if="listFreshness.stale && rows.length > 0" class="text-sm text-caution-700">
      {{ listFreshness.text }}
    </p>

    <FilterBar
      v-model:search="search"
      search-placeholder="Last four, unit or driver ID…"
      :count="rows.length"
      count-label="cards"
      :chips="chips"
      @remove="onRemoveChip"
      @clear-all="status = ''"
    >
      <template #filters>
        <FilterSelect
          v-model="status"
          label="Status"
          :options="[
            { value: '', label: 'Any status' },
            { value: 'Active', label: 'Active' },
            { value: 'Hold', label: 'On hold' },
            { value: 'Inactive', label: 'Inactive' },
            { value: 'Fraud', label: 'Fraud hold' },
          ]"
        />
      </template>
    </FilterBar>

    <DataTable
      :columns="columns"
      :rows="paged"
      row-key="id"
      :loading="query.isLoading.value"
      :error="query.isError.value ? (query.error.value?.message ?? 'Could not load cards') : undefined"
      empty-text="No cards yet. Refresh from EFS to pull this account's card list."
      @retry="query.refetch()"
      @row-click="(row) => router.push(`/fuel-cards/${(row as EfsCardRow).id}`)"
    >
      <template #cell-status="{ row }">
        <span :class="[BADGE_BASE, toneClass(cardStatusTone((row as EfsCardRow).status))]">
          {{ cardStatusLabel((row as EfsCardRow).status) }}
        </span>
      </template>
      <template #cell-overrideUses="{ row }">
        <!-- An active override is the fact a fraud reviewer most wants to spot in a list. -->
        <span
          v-if="((row as EfsCardRow).overrideUses ?? 0) > 0"
          :class="[BADGE_BASE, toneClass('warning')]"
        >
          {{ (row as EfsCardRow).overrideUses }} left
        </span>
        <span v-else class="text-ink-subtle">—</span>
      </template>
      <template #footer>
        <TablePagination v-model:page="page" :page-size="PAGE_SIZE" :total="rows.length" />
      </template>
    </DataTable>
  </div>
</template>
