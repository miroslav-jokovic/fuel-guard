<script setup lang="ts">
import { computed } from "vue";
import { AppCard as BaseCard } from "@silvicom/ui";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import type { FamilySummaryResponse, FamilyRow } from "./useFleetReport";

/**
 * The family summary (G6) — ninety-four rows of statement read as ten rows of answer.
 *
 * It sits above the income statement rather than replacing it, because the two do different jobs:
 * the statement is the document the owner already reconciles line by line, and this is what a boss
 * reads in ten seconds. Fuel at $6.4M means nothing until it is 22% of revenue and 64 cents of
 * every mile, and no ordering of ninety-four accounts produces that sentence.
 *
 * **The grouping is signed, not derived** — see `glFamilies.ts`. McLeod files IRP under General &
 * Admin next to the rent, and every account name is truncated to 28 characters at source, so
 * neither the class nor the name can carry a family. The owner ruled on all 100 accounts on
 * 2026-09-03.
 *
 * Nothing is computed here. A family that shows a dash for its rate has a period whose mileage
 * could not cover the fleet, and the reason is printed above the tabs, not invented per row.
 */

const props = defineProps<{ families: FamilySummaryResponse; showToDate: boolean; loading?: boolean }>();

const fmtUsd = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtPct = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`);
const fmtRate = (n: number | null) =>
  n == null ? "—" : n.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2 });

interface Row extends FamilyRow {
  id: string;
  amountText: string;
  pctText: string;
  perMileText: string;
  toDateText: string;
  accountsText: string;
}
const toRow = (f: FamilyRow): Row => ({
  ...f,
  id: f.key,
  amountText: fmtUsd(f.amount),
  pctText: fmtPct(f.pctOfRevenue),
  perMileText: fmtRate(f.perMile),
  toDateText: f.toDateAmount == null ? "—" : fmtUsd(f.toDateAmount),
  accountsText: String(f.accounts),
});

const expense = computed(() => props.families.expense.map(toRow));
const revenue = computed(() => props.families.revenue.map(toRow));

/** A family's share as a bar width, scaled to the largest share on either side of the statement. */
const widestShare = computed(() =>
  Math.max(1, ...[...props.families.expense, ...props.families.revenue].map((f) => f.pctOfRevenue ?? 0)),
);
const shareWidth = (pct: number | null) => `${Math.max(0, Math.min(100, ((pct ?? 0) / widestShare.value) * 100))}%`;

const columns = computed<DataTableColumn[]>(() => [
  { key: "label", label: "Where it goes" },
  { key: "amountText", label: "This period", numeric: true },
  { key: "pctText", label: "% of revenue", numeric: true },
  { key: "perMileText", label: "Per mile", numeric: true },
  ...(props.showToDate ? [{ key: "toDateText", label: "Year to date", numeric: true }] : []),
]);
const revenueColumns = computed<DataTableColumn[]>(() =>
  columns.value.map((c) => (c.key === "label" ? { ...c, label: "Where it comes from" } : c)),
);

/**
 * Non-zero means an account is filed on one side of the statement and grouped on the other. It is
 * shown rather than logged: the summary's whole claim is that it adds up to the statement above it.
 */
const drift = computed(() => {
  const t = props.families.tieOut;
  return t.revenue !== 0 || t.expenses !== 0 ? t : null;
});
</script>

<template>
  <div class="space-y-4">
    <BaseCard padding="none">
      <div class="border-b border-edge px-4 py-3">
        <h3 class="text-sm font-semibold text-ink">Ten families</h3>
        <p class="mt-0.5 text-xs text-ink-tertiary">
          Every expense account grouped the way the fleet is actually run, largest first. The
          statement below has the same money in McLeod's own ninety-four rows.
        </p>
      </div>
      <DataTable embedded :columns="columns" :rows="expense" row-key="id" :loading="loading">
        <template #cell-label="{ row }">
          <span :class="row.isUnassigned ? 'text-warning-700' : 'text-ink'">{{ row.label }}</span>
          <!-- How many McLeod accounts are inside this family. Glanced at, not read, so text-2xs
               (D-DS6) — and titled, because a bare number beside a name is a riddle. -->
          <span
            class="ml-2 text-2xs text-ink-tertiary"
            :title="`${row.accountsText} McLeod account${row.accounts === 1 ? '' : 's'} in this family`"
            >{{ row.accountsText }}</span
          >
        </template>
        <template #cell-amountText="{ row }">
          <span class="tabular-nums font-medium text-ink">{{ row.amountText }}</span>
        </template>
        <!-- The share as a bar first and a number second (R4/R6, D-FRUI4): one hue at 70%, the
             track the same hue at 9%, scaled to the largest family so the column reads as a shape. -->
        <template #cell-pctText="{ row }">
          <span class="inline-flex items-center justify-end gap-2">
            <span class="inline-block h-1.5 w-16 overflow-hidden rounded-detail bg-brand-500/10" aria-hidden="true">
              <span class="block h-full rounded-detail bg-brand-500/70" :style="{ width: shareWidth(row.pctOfRevenue) }" />
            </span>
            <span class="tabular-nums text-ink-secondary">{{ row.pctText }}</span>
          </span>
        </template>
        <template #cell-perMileText="{ row }">
          <span class="tabular-nums text-ink-secondary">{{ row.perMileText }}</span>
        </template>
        <template #cell-toDateText="{ row }">
          <span class="tabular-nums text-ink-secondary">{{ row.toDateText }}</span>
        </template>
      </DataTable>
    </BaseCard>

    <!-- Hidden rather than shown empty: a period with no income at all is a fact the overview
         states, and an empty table under a heading reads as a loading failure. -->
    <BaseCard v-if="revenue.length" padding="none">
      <DataTable embedded :columns="revenueColumns" :rows="revenue" row-key="id" :loading="loading">
        <template #cell-label="{ row }">
          <span :class="row.isUnassigned ? 'text-warning-700' : 'text-ink'">{{ row.label }}</span>
          <!-- How many McLeod accounts are inside this family. Glanced at, not read, so text-2xs
               (D-DS6) — and titled, because a bare number beside a name is a riddle. -->
          <span
            class="ml-2 text-2xs text-ink-tertiary"
            :title="`${row.accountsText} McLeod account${row.accounts === 1 ? '' : 's'} in this family`"
            >{{ row.accountsText }}</span
          >
        </template>
        <template #cell-amountText="{ row }">
          <span class="tabular-nums font-medium text-ink">{{ row.amountText }}</span>
        </template>
        <!-- The share as a bar first and a number second (R4/R6, D-FRUI4): one hue at 70%, the
             track the same hue at 9%, scaled to the largest family so the column reads as a shape. -->
        <template #cell-pctText="{ row }">
          <span class="inline-flex items-center justify-end gap-2">
            <span class="inline-block h-1.5 w-16 overflow-hidden rounded-detail bg-brand-500/10" aria-hidden="true">
              <span class="block h-full rounded-detail bg-brand-500/70" :style="{ width: shareWidth(row.pctOfRevenue) }" />
            </span>
            <span class="tabular-nums text-ink-secondary">{{ row.pctText }}</span>
          </span>
        </template>
        <template #cell-perMileText="{ row }">
          <span class="tabular-nums text-ink-secondary">{{ row.perMileText }}</span>
        </template>
        <template #cell-toDateText="{ row }">
          <span class="tabular-nums text-ink-secondary">{{ row.toDateText }}</span>
        </template>
      </DataTable>
    </BaseCard>

    <p v-if="drift" class="text-sm text-danger-600">
      These families do not add up to the statement below — {{ fmtUsd(drift.revenue) }} of revenue and
      {{ fmtUsd(drift.expenses) }} of expense are grouped on the wrong side. The statement is right;
      this summary is not.
    </p>
    <p v-else class="text-xs text-ink-tertiary">
      A family is a grouping the owner signed, not one the ledger holds: McLeod files IRP with the
      office costs and truncates every account name at 28 characters, so neither its class nor its
      name can say where a cost belongs. Every account is in exactly one family, and the families add
      up to the statement below.
    </p>
  </div>
</template>
