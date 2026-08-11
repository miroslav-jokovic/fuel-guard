<script setup lang="ts">
/**
 * The fuel-card inventory, as EFS reports it.
 *
 * New surface: until now FuelGuard has only ever INFERRED card state from fill history
 * (learnCardAssignments), so "is this card locked?" had no answer. These rows come from the vendor.
 */
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { AppButton as BaseButton } from "@fuelguard/ui";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import TablePagination from "@/components/TablePagination.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useToastStore } from "@/stores/toast";
import { cardAssignmentRank, cardStatusLabel, cardStatusTone, compareCardValues, freshness } from "@/features/fuelCards/cardControlModel";
import { useJob } from "@/features/jobs/useJob";
import { useEfsCards, useSyncEfsCards, type EfsCardRow } from "@/features/fuelCards/useEfsCards";

const PAGE_SIZE = 20;

const router = useRouter();
const toast = useToastStore();

const search = ref("");
const status = ref("");
/**
 * The secondary facets. Applied CLIENT-side, deliberately: the route returns the whole inventory in
 * one response and this page already paginates in the browser, so filtering here is instant and adds
 * no vendor-adjacent API surface. Search and status stay server-side because they were already.
 */
const driver = ref("");
const unit = ref("");
const policy = ref("");
const override = ref("");
const linked = ref("");
const health = ref("");
const page = ref(1);
/**
 * `assignment` is the DEFAULT order, not a column: cards nobody is using sink to the bottom and the
 * working fleet keeps card order above them. Clicking any header replaces it with that column.
 */
const sort = ref<{ key: string; dir: "asc" | "desc" }>({ key: "assignment", dir: "asc" });

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

watch([search, status, driver, unit, policy, override, linked, health], () => { page.value = 1; });

const allRows = computed(() => query.data.value?.cards ?? []);

/** Options built from the data on screen, so a filter can never offer a value that matches nothing. */
const optionsFrom = (pick: (row: EfsCardRow) => string | number | null, anyLabel: string) =>
  computed(() => [
    { value: "", label: anyLabel },
    ...[...new Set(allRows.value.map(pick).filter((v): v is string | number => v !== null && v !== ""))]
      .map(String)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((v) => ({ value: v, label: v })),
  ]);

const driverOptions = optionsFrom((r) => r.driverName, "Any driver");
const unitOptions = optionsFrom((r) => r.unitPrompt, "Any unit");
const policyOptions = optionsFrom((r) => r.policyNumber, "Any policy");

const rows = computed(() =>
  allRows.value.filter((r) => {
    if (driver.value && r.driverName !== driver.value) return false;
    if (unit.value && r.unitPrompt !== unit.value) return false;
    if (policy.value && String(r.policyNumber ?? "") !== policy.value) return false;
    // An active exception is the thing an auditor scans this page for — "who can currently buy fuel
    // outside their limits" is one click, not a sort down a 199-row list.
    if (override.value === "active" && (r.overrideUses ?? 0) <= 0) return false;
    if (override.value === "none" && (r.overrideUses ?? 0) > 0) return false;
    if (linked.value === "linked" && !r.fuelCardId) return false;
    if (linked.value === "unlinked" && r.fuelCardId) return false;
    // 140 of this fleet's 199 cards carried a sync error at one point and nothing on screen said so.
    if (health.value === "errors" && !r.syncError) return false;
    if (health.value === "ok" && r.syncError) return false;
    return true;
  }),
);

const sorted = computed(() => {
  const { key, dir } = sort.value;

  if (key === "assignment") {
    return [...rows.value].sort(
      (a, b) =>
        cardAssignmentRank(a) - cardAssignmentRank(b)
        // Within each group, card order — the thing somebody reading a printed card is matching on.
        || compareCardValues(a.last4, b.last4, "asc"),
    );
  }

  const value = (row: EfsCardRow): string | number => {
    switch (key) {
      case "status": return row.status ?? "";
      case "unitPrompt": return row.unitPrompt ?? "";
      case "driverName": return row.driverName ?? "";
      case "driverIdPrompt": return row.driverIdPrompt ?? "";
      case "policyNumber": return row.policyNumber ?? 0;
      case "overrideUses": return row.overrideUses ?? 0;
      case "lastUsedDate": return row.lastUsedDate ?? "";
      default: return row.last4 ?? "";
    }
  };
  return [...rows.value].sort((a, b) => compareCardValues(value(a), value(b), dir));
});

const paged = computed(() => sorted.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

function onSort(key: string): void {
  sort.value = sort.value.key === key
    ? { key, dir: sort.value.dir === "asc" ? "desc" : "asc" }
    : { key, dir: "asc" };
}

/** True when the API had more cards than it returned — see the limit note on the read route. */
const truncated = computed(() => (query.data.value?.total ?? 0) > allRows.value.length);

/** Oldest row wins: the banner should reflect the least fresh thing on screen, not the average. */
const oldestSync = computed(() => {
  const times = rows.value.map((r) => r.syncedAt).filter(Boolean).sort();
  return times[0] ?? null;
});
const listFreshness = computed(() => freshness(oldestSync.value, new Date(), query.data.value?.staleAfterMinutes));

const columns: DataTableColumn[] = [
  { key: "maskedRef", label: "Card", sortable: true, headerClass: "min-w-[8rem]", cellClass: "font-medium text-ink" },
  { key: "status", label: "Status", sortable: true, headerClass: "min-w-[7rem]" },
  { key: "driverName", label: "Driver", sortable: true, headerClass: "min-w-[10rem]" },
  { key: "unitPrompt", label: "Unit", sortable: true, headerClass: "min-w-[6rem]" },
  { key: "driverIdPrompt", label: "Driver ID", sortable: true, headerClass: "min-w-[8rem]" },
  { key: "policyNumber", label: "Policy", sortable: true, numeric: true, headerClass: "min-w-[5rem]" },
  { key: "overrideUses", label: "Override", sortable: true, headerClass: "min-w-[6rem]" },
];

/** Every active facet gets a chip, so nothing narrows the list invisibly. */
const chips = computed(() => [
  ...(status.value ? [{ key: "status", label: "Status", value: cardStatusLabel(status.value) }] : []),
  ...(driver.value ? [{ key: "driver", label: "Driver", value: driver.value }] : []),
  ...(unit.value ? [{ key: "unit", label: "Unit", value: unit.value }] : []),
  ...(policy.value ? [{ key: "policy", label: "Policy", value: policy.value }] : []),
  ...(override.value ? [{ key: "override", label: "Exception", value: override.value === "active" ? "Active" : "None" }] : []),
  ...(linked.value ? [{ key: "linked", label: "Vehicle", value: linked.value === "linked" ? "Linked" : "Not linked" }] : []),
  ...(health.value ? [{ key: "health", label: "Sync", value: health.value === "errors" ? "With errors" : "Clean" }] : []),
]);

const FACETS: Record<string, { value: string }> = {
  status: status as unknown as { value: string },
  driver: driver as unknown as { value: string },
  unit: unit as unknown as { value: string },
  policy: policy as unknown as { value: string },
  override: override as unknown as { value: string },
  linked: linked as unknown as { value: string },
  health: health as unknown as { value: string },
};

function onRemoveChip(key: string): void {
  const facet = FACETS[key];
  if (facet) facet.value = "";
}

function clearAll(): void {
  for (const facet of Object.values(FACETS)) facet.value = "";
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
      @clear-all="clearAll"
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
        <FilterSelect v-model="driver" label="Driver" :options="driverOptions" />
        <FilterSelect v-model="unit" label="Unit" :options="unitOptions" />
      </template>
      <template #more>
        <FilterSelect v-model="policy" label="Policy" :options="policyOptions" block />
        <FilterSelect
          v-model="override"
          label="Exception"
          block
          :options="[
            { value: '', label: 'Any' },
            { value: 'active', label: 'Has an active exception' },
            { value: 'none', label: 'No exception' },
          ]"
        />
        <FilterSelect
          v-model="linked"
          label="Vehicle"
          block
          :options="[
            { value: '', label: 'Any' },
            { value: 'linked', label: 'Linked to a vehicle' },
            { value: 'unlinked', label: 'Not linked' },
          ]"
        />
        <FilterSelect
          v-model="health"
          label="Last sync"
          block
          :options="[
            { value: '', label: 'Any' },
            { value: 'errors', label: 'Reported an error' },
            { value: 'ok', label: 'Clean' },
          ]"
        />
      </template>
    </FilterBar>

    <p v-if="truncated" class="text-sm text-caution-700">
      Showing {{ allRows.length }} of {{ query.data.value?.total }} cards. Narrow the search to see the rest.
    </p>

    <DataTable
      :columns="columns"
      :rows="paged"
      row-key="id"
      :sort="sort"
      :loading="query.isLoading.value"
      :error="query.isError.value ? (query.error.value?.message ?? 'Could not load cards') : undefined"
      empty-text="No cards yet. Refresh from EFS to pull this account's card list."
      @sort="onSort"
      @retry="query.refetch()"
      @row-click="(row) => router.push(`/fuel-cards/${(row as EfsCardRow).id}`)"
    >
      <template #cell-driverName="{ row }">
        <span v-if="(row as EfsCardRow).driverName">{{ (row as EfsCardRow).driverName }}</span>
        <span v-else class="text-ink-tertiary">—</span>
      </template>

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
        <span v-else class="text-ink-tertiary">—</span>
      </template>
      <template #footer>
        <TablePagination v-model:page="page" :page-size="PAGE_SIZE" :total="rows.length" />
      </template>
    </DataTable>
  </div>
</template>
