<script setup lang="ts">
import { computed, ref, toRef } from "vue";
import { DQ_KIND_LABELS, type CertificationRow } from "@fuelguard/shared";
import { AppCard as BaseCard } from "@fuelguard/ui";
import { AppButton as BaseButton } from "@fuelguard/ui";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDate } from "@/lib/format";
import { useCertificationHistoryQuery } from "@/composables/useCompliance";

/**
 * What this file used to say (DQ-BINDER-PLAN §4).
 *
 * The supersede chain has existed since 0127 and `includeHistory` since the same migration, and no
 * screen has ever asked for it — so "what did his medical card say on 3 March" was answerable by the
 * database and by nobody using the product. Nothing new is stored here; something already stored
 * becomes visible.
 *
 * Collapsed by default, because a clean file should stay a short page: the card states how many
 * superseded records exist and opens on request.
 */
const props = defineProps<{ driverId: string }>();

const query = useCertificationHistoryQuery(toRef(props, "driverId"));
const open = ref(false);

interface Row {
  id: string;
  label: string;
  detail: string;
  identifier: string;
  covered: string;
  standing: string;
}

const superseded = computed(() =>
  (query.data.value ?? []).filter((c: CertificationRow) => c.superseded_by !== null),
);

const rows = computed<Row[]>(() =>
  superseded.value.map((c) => ({
    id: c.id,
    label: DQ_KIND_LABELS[c.kind] ?? c.kind,
    detail: [c.qualifier ? `endorsement ${c.qualifier}` : null, c.issuing_authority]
      .filter(Boolean)
      .join(" · "),
    identifier: c.identifier ?? "—",
    covered: `${formatDate(c.effective_from)} → ${c.expires_at ? formatDate(c.expires_at) : "No expiry"}`,
    standing: c.superseded_at ? `Replaced ${formatDate(c.superseded_at)}` : "Replaced",
  })),
);

const columns: DataTableColumn[] = [
  {
    key: "label",
    label: "Certification",
    headerClass: "min-w-[14rem]",
    cellClass: "font-medium text-ink",
  },
  {
    key: "identifier",
    label: "Identifier",
    headerClass: "min-w-[9rem]",
    cellClass: "text-ink-secondary",
  },
  {
    key: "covered",
    label: "Covered",
    headerClass: "min-w-[12rem]",
    cellClass: "text-ink-secondary",
  },
  { key: "standing", label: "Standing", headerClass: "w-40" },
];
</script>

<template>
  <BaseCard v-if="superseded.length > 0">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 class="text-sm font-semibold text-ink">History</h3>
        <p class="mt-1 text-sm text-ink-muted">
          {{ superseded.length }} superseded {{ superseded.length === 1 ? "record" : "records" }}.
          Renewals never overwrite what came before, so what was on file on a past date is still
          answerable.
        </p>
      </div>
      <BaseButton variant="ghost" size="sm" @click="open = !open">
        {{ open ? "Hide history" : "Show history" }}
      </BaseButton>
    </div>

    <div v-if="open" class="mt-4">
      <DataTable
        :columns="columns"
        :rows="rows"
        row-key="id"
        :sticky-header="false"
        :loading="query.isLoading.value"
        :error="
          query.isError.value ? (query.error.value?.message ?? 'Could not load the history.') : null
        "
        :retrying="query.isFetching.value"
        empty-text="Nothing has been superseded yet."
        @retry="query.refetch()"
      >
        <template #cell-label="{ row }">
          <span class="text-ink">{{ row.label }}</span>
          <span v-if="row.detail" class="mt-0.5 block text-xs text-ink-tertiary">{{
            row.detail
          }}</span>
        </template>
        <template #cell-standing="{ row }">
          <span :class="[BADGE_BASE, toneClass('neutral')]">superseded</span>
          <span class="mt-0.5 block text-xs text-ink-tertiary">{{ row.standing }}</span>
        </template>
      </DataTable>
    </div>
  </BaseCard>
</template>
