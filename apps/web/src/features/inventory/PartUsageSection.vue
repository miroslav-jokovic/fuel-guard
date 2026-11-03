<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
import { RouterLink } from "vue-router";
import { AppCard as BaseCard, DataTable, FactList, QueryState, TablePagination, type DataTableColumn, type Fact } from "@silvicom/ui";
import { PART_HISTORY_PAGE_SIZE, REPEAT_WITHIN_DAYS, isRepeatOnUnit, type PartUseDto } from "@silvicom/shared";
import { usePartUsageDetailQuery } from "./usePartUsage";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDate } from "@/lib/format";

/**
 * How the shop uses one part, and where it went (SHOP-PARTS-USAGE-PLAN.md SP-U2) — the part's page's
 * answer to "how many do we go through" and "which truck did it go on", from FleetPal's repair orders.
 *
 * ── "AGAIN AFTER 12 DAYS" IS A FACT, NOT A VERDICT (D-SPU5, Q-SPU2) ──────────────────────────
 * SQL measures the days since the same part went on the same unit; `isRepeatOnUnit` decides what is
 * "soon" (REPEAT_WITHIN_DAYS). The badge states the gap and nothing else: a tire on the same trailer
 * twice in a month may be another wheel, and a mechanic reading "repeat repair" would be told something
 * the data cannot know.
 *
 * ── NO PRICES (D-SPU4) ────────────────────────────────────────────────────────────────────────
 * D-FP4: no FleetPal money without its coverage ratio. Quantities and dates only, until Q-SPU1.
 *
 * A part typed here before F12 has no FleetPal id, so no repair order can name it — the section says
 * that rather than "never used", which would be a claim about the shop.
 */
const props = defineProps<{ partId: string; fromFleetpal: boolean }>();

const page = ref(1);
watch(
  () => props.partId,
  () => (page.value = 1),
);
const { data, isLoading, isError, isFetching, refetch } = usePartUsageDetailQuery(toRef(props, "partId"), page);

const summary = computed(() => data.value?.summary ?? null);
const uses = computed(() => data.value?.uses ?? []);

const qty = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const onRepairs = (quantity: number, repairs: number) =>
  repairs === 0 ? "None" : `${qty.format(quantity)} on ${repairs} ${repairs === 1 ? "repair" : "repairs"}`;

const facts = computed<Fact[]>(() => {
  const s = summary.value;
  if (!s) return [];
  return [
    { label: "Last 90 days", value: onRepairs(s.quantity90d, s.repairs90d) },
    { label: "Last 12 months", value: onRepairs(s.quantity365d, s.repairs365d) },
    { label: "Trucks and trailers", value: `${s.units365d} in 12 months` },
    { label: "Last used", value: s.lastUsedAt ? formatDate(s.lastUsedAt) : "Never" },
  ];
});

// The "again" badge sits beside the unit it is about, not in a column of its own: on a phone card an
// empty note column drew a dash under every row, and the badge means nothing apart from its unit.
const COLUMNS: DataTableColumn[] = [
  { key: "usedAt", label: "Date", card: "meta", width: "md", cellClass: "text-ink-secondary" },
  { key: "unit", label: "Truck or trailer", card: "title" },
  { key: "quantity", label: "Quantity", card: "none", numeric: true, width: "sm" },
  { key: "workOrderNumber", label: "Repair order", card: "sentence", cellClass: "text-ink-secondary" },
];

const rowKey = (r: PartUseDto) => `${r.workOrderNumber ?? "?"}:${r.usedAt ?? ""}:${r.unit.number ?? ""}`;
const unitTo = (u: PartUseDto["unit"]) => (u.kind && u.id ? { name: "unit", params: { kind: u.kind, id: u.id } } : null);
const dayWord = (n: number) => (n === 1 ? "day" : "days");
</script>

<template>
  <section class="space-y-3" data-test="part-usage">
    <BaseCard>
      <h2 class="text-sm font-semibold text-ink">How much the shop uses it</h2>
      <p v-if="!fromFleetpal" class="mt-2 text-sm text-ink-secondary">
        This part was added here, not in FleetPal, so FleetPal's repair orders cannot name it.
      </p>
      <QueryState
        v-else
        class="mt-2"
        compact
        :loading="isLoading"
        :error="isError ? true : null"
        :retrying="isFetching"
        error-text="Could not load how this part was used."
        loading-text="Loading how this part was used…"
        @retry="refetch()"
      >
        <FactList class="mt-4" :facts="facts" />
      </QueryState>
    </BaseCard>

    <template v-if="fromFleetpal">
      <h2 class="text-sm font-semibold text-ink">Where it went</h2>
      <DataTable
        :columns="COLUMNS"
        :rows="uses"
        :row-key="rowKey"
        :loading="isLoading"
        :error="isError ? 'Could not load the repairs that used this part.' : null"
        @retry="refetch()"
      >
        <template #cell-usedAt="{ value }">{{ formatDate(value) }}</template>
        <template #cell-unit="{ row }">
          <RouterLink v-if="unitTo(row.unit)" :to="unitTo(row.unit)!" class="font-semibold text-brand-700 hover:underline">
            {{ row.unit.number ?? "Unnamed unit" }}
          </RouterLink>
          <span v-else-if="row.unit.number" class="text-ink-secondary" :title="'FleetPal unit not linked to one of our trucks or trailers'">
            {{ row.unit.number }} <span class="text-ink-tertiary">· not linked</span>
          </span>
          <span v-else class="text-ink-tertiary">No unit on the repair order</span>
          <span
            v-if="isRepeatOnUnit(row.daysSincePreviousOnUnit)"
            :class="[BADGE_BASE, toneClass('caution'), 'ml-2']"
            data-test="again-on-unit"
            :title="`The same part went on this unit within ${REPEAT_WITHIN_DAYS} days`"
          >
            Again after {{ row.daysSincePreviousOnUnit }} {{ dayWord(row.daysSincePreviousOnUnit!) }}
          </span>
        </template>
        <template #cell-quantity="{ value }">{{ qty.format(value) }}</template>
        <template #cell-workOrderNumber="{ row }">
          <span v-if="row.workOrderNumber !== null">#{{ row.workOrderNumber }}</span>
          <!-- The card has no Quantity column (below md), so its sentence carries the count. -->
          <span class="md:hidden"> · {{ qty.format(row.quantity) }} used</span>
          <span v-if="row.workOrderStatus === 'OPEN'" :class="[BADGE_BASE, toneClass('info'), 'ml-2']">Still open</span>
        </template>
        <template #empty>
          <p>No repair order has used this part yet.</p>
        </template>
        <template #footer>
          <TablePagination
            :page="page"
            :page-size="PART_HISTORY_PAGE_SIZE"
            :total="data?.total ?? 0"
            @update:page="page = $event"
          />
        </template>
      </DataTable>
    </template>
  </section>
</template>
