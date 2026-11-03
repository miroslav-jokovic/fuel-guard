<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
import { RouterLink } from "vue-router";
import {
  AppCard as BaseCard,
  DataTable,
  FactList,
  QueryState,
  TablePagination,
  columnsWithData,
  type DataTableColumn,
  type Fact,
} from "@silvicom/ui";
import {
  PART_HISTORY_PAGE_SIZE,
  PRICE_WELL_ABOVE_RATIO,
  REPEAT_WITHIN_DAYS,
  isPriceWellAbove,
  isRepeatOnUnit,
  usd2,
  type PartUseDto,
} from "@silvicom/shared";
import { usePartUsageDetailQuery } from "./usePartUsage";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDate } from "@/lib/format";

/**
 * How the shop uses one part, and where it went (SHOP-PARTS-USAGE-PLAN.md SP-U2, SP-U3) — the part's
 * page's answer to "how many do we go through", "what do we pay" and "which truck did it go on", from
 * FleetPal's repair orders.
 *
 * ── NOTHING DRAWN OVER NOTHING (D-SPU11, owner 2026-11-03) ────────────────────────────────────
 * "Let's not have empty rows and columns if data does not exist." A fact is listed only when it has a
 * value — no "None", no "0 in 12 months", no "Never" — and a part no repair order ever named gets one
 * sentence and no "Where it went" table at all. In the table, a Price column every row on the page
 * leaves empty is not drawn (`columnsWithData`).
 *
 * ── PRICES: UNIT, NEVER SUMMED (D-SPU10) ─────────────────────────────────────────────────────
 * Last price, the 12-month typical (median, only on ≥ TYPICAL_PRICE_MIN_REPAIRS priced repairs) and the
 * 12-month range; a repair at ≥ PRICE_WELL_ABOVE_RATIO × typical reads "Well above usual" — a reason to
 * look at the bill, not a finding about it.
 *
 * ── "AGAIN AFTER 12 DAYS" IS A FACT, NOT A VERDICT (D-SPU5, Q-SPU2) ──────────────────────────
 * SQL measures the days since the same part went on the same unit; `isRepeatOnUnit` decides what is
 * "soon". The badge states the gap only: a tire on the same trailer twice in a month may be another
 * wheel. It sits beside its unit, which is what it is about.
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
/** Loaded, and no repair order ever named this part. */
const neverUsed = computed(() => Boolean(summary.value) && summary.value!.lastUsedAt === null && (data.value?.total ?? 0) === 0);

const qty = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const onRepairs = (quantity: number, repairs: number) =>
  `${qty.format(quantity)} on ${repairs} ${repairs === 1 ? "repair" : "repairs"}`;

const facts = computed<Fact[]>(() => {
  const s = summary.value;
  if (!s) return [];
  const out: Fact[] = [];
  if (s.repairs90d > 0) out.push({ label: "Last 90 days", value: onRepairs(s.quantity90d, s.repairs90d) });
  if (s.repairs365d > 0) out.push({ label: "Last 12 months", value: onRepairs(s.quantity365d, s.repairs365d) });
  if (s.units365d > 0) out.push({ label: "Trucks and trailers", value: `${s.units365d} in 12 months` });
  if (s.lastUsedAt) out.push({ label: "Last used", value: formatDate(s.lastUsedAt) });
  if (s.lastPrice !== null) out.push({ label: "Last price", value: `${usd2(s.lastPrice)} each` });
  if (s.typicalPrice !== null) out.push({ label: "Typical price", value: `${usd2(s.typicalPrice)} each` });
  // One price is not a range; a range is drawn only when the year saw two different prices.
  if (s.lowPrice365d !== null && s.highPrice365d !== null && s.lowPrice365d !== s.highPrice365d) {
    out.push({ label: "Price range, 12 months", value: `${usd2(s.lowPrice365d)} – ${usd2(s.highPrice365d)}` });
  }
  return out;
});

const COLUMNS: DataTableColumn[] = [
  { key: "usedAt", label: "Date", card: "meta", width: "md", cellClass: "text-ink-secondary" },
  { key: "unit", label: "Truck or trailer", card: "title" },
  { key: "quantity", label: "Quantity", card: "none", numeric: true, width: "sm" },
  { key: "unitPrice", label: "Price each", card: "none", numeric: true },
  { key: "workOrderNumber", label: "Repair order", card: "sentence", cellClass: "text-ink-secondary" },
];
const columns = computed(() =>
  columnsWithData(COLUMNS, uses.value as unknown as Record<string, unknown>[], {
    keep: ["usedAt", "unit", "quantity", "workOrderNumber"],
  }),
);

const wellAbove = (row: PartUseDto) => isPriceWellAbove(row.unitPrice, summary.value?.typicalPrice ?? null);
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
        <p v-if="neverUsed" class="text-sm text-ink-secondary">No repair order has used this part yet.</p>
        <FactList v-else class="mt-4" :facts="facts" />
      </QueryState>
    </BaseCard>

    <template v-if="fromFleetpal && !neverUsed">
      <h2 class="text-sm font-semibold text-ink">Where it went</h2>
      <DataTable
        :columns="columns"
        :rows="uses"
        :row-key="rowKey"
        :loading="isLoading"
        :error="isError ? 'Could not load the repairs that used this part.' : null"
        empty-text="No repairs on this page — go back a page."
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
        <template #cell-unitPrice="{ row }">
          <span v-if="row.unitPrice !== null">{{ usd2(row.unitPrice) }}</span>
          <span
            v-if="wellAbove(row)"
            :class="[BADGE_BASE, toneClass('warning'), 'ml-2']"
            data-test="price-well-above"
            :title="`At least ${PRICE_WELL_ABOVE_RATIO}× the typical ${usd2(summary?.typicalPrice)}`"
          >
            Well above usual
          </span>
        </template>
        <template #cell-workOrderNumber="{ row }">
          <span v-if="row.workOrderNumber !== null">#{{ row.workOrderNumber }}</span>
          <!-- The card has no Quantity or Price column (below md), so its sentence carries both. -->
          <span class="md:hidden">
            · {{ qty.format(row.quantity) }} used<template v-if="row.unitPrice !== null"> · {{ usd2(row.unitPrice) }} each</template>
          </span>
          <span v-if="row.workOrderStatus === 'OPEN'" :class="[BADGE_BASE, toneClass('info'), 'ml-2']">Still open</span>
          <span v-if="wellAbove(row)" :class="[BADGE_BASE, toneClass('warning'), 'ml-2 md:hidden']" data-test="price-well-above">Well above usual</span>
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
