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
import { useEfsCards, useSyncEfsCards, type EfsCardRow } from "@/features/fuelCards/useEfsCards";

const PAGE_SIZE = 20;

const router = useRouter();
const toast = useToastStore();

const search = ref("");
const status = ref("");
const page = ref(1);

const query = useEfsCards({ search, status });
const sync = useSyncEfsCards();

watch([search, status], () => { page.value = 1; });

const rows = computed(() => query.data.value?.cards ?? []);
const paged = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

/** Oldest row wins: the banner should reflect the least fresh thing on screen, not the average. */
const oldestSync = computed(() => {
  const times = rows.value.map((r) => r.syncedAt).filter(Boolean).sort();
  return times[0] ?? null;
});
const listFreshness = computed(() => freshness(oldestSync.value));

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
  } catch (e) {
    toast.error("Could not start the refresh", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Every EFS card on this account, with the settings EFS currently reports.">
      <template #actions>
        <BaseButton variant="secondary" :disabled="sync.isPending.value" @click="onSync">
          {{ sync.isPending.value ? "Starting…" : "Refresh from EFS" }}
        </BaseButton>
      </template>
    </PageHeader>

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
