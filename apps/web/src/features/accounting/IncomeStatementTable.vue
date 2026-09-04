<script setup lang="ts">
import { computed, ref } from "vue";
import { AppCard as BaseCard, AppButton as BaseButton, AppIcon } from "@silvicom/ui";
import { ChevronDownIcon, ChevronRightIcon } from "@silvicom/ui/icons";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import type { StatementSection, StatementLine } from "./useIncomeStatement";

/**
 * One section of the income statement — Revenue, Operating Expenses, and so on.
 *
 * A card per section rather than one long table, because that is how the statement the owner
 * already reads is laid out: a heading, its accounts, its subtotal. It is also the reason this
 * table does NOT paginate, which is a deliberate exception to the house rule. A profit-and-loss
 * statement read across pages is not a statement; the sections are what break it up, and the
 * ten-row family summary (G6) is the short view for a reader who does not want all ninety-four.
 *
 * Every row shows its ACCOUNT CODE beside the name. McLeod truncates `gl_account.descr` to 28
 * characters at source, so three separate revenue accounts all read "Gross Trucking Income" and two
 * expense accounts read "Subcontracted Labor: Bonus" — without the code the reader sees the same
 * line three times and has no way to tell them apart.
 */

const props = defineProps<{
  section: StatementSection;
  loading?: boolean;
  /** Hidden when the statement has no comparative period. */
  showToDate: boolean;
  /**
   * What the comparative column holds — "Year to date" or the previous period's name (R6). The
   * harness calls the column `toDate` whatever is in it; the label is what the reader sees.
   */
  compareLabel?: string;
}>();
const compareLabel = computed(() => props.compareLabel ?? "Year to date");

const expanded = ref(new Set<string>());
function toggle(row: StatementLine) {
  const next = new Set(expanded.value);
  if (next.has(row.glid)) next.delete(row.glid);
  else next.add(row.glid);
  expanded.value = next;
}

const fmtUsd = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2 });
// A share of revenue is a share, not a measurement of one: null means the period booked no revenue
// to divide by, and prints as a dash rather than as 0.0% (D-FIN10).
const fmtPct = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`);

const columns = computed<DataTableColumn[]>(() => [
  { key: "descr", label: "Account" },
  { key: "amount", label: "This period", numeric: true },
  { key: "pctOfRevenue", label: "% of revenue", numeric: true },
  ...(props.showToDate
    ? [
        { key: "toDateAmount", label: compareLabel.value, numeric: true },
        { key: "toDatePctOfRevenue", label: "% of revenue", numeric: true },
      ]
    : []),
]);
</script>

<template>
  <BaseCard padding="none">
    <!-- The section heading stays in view while its rows scroll under it (R6), so a reader ninety
         rows into Operating Expenses still knows which section the figure belongs to. Static on
         paper. -->
    <div class="print-static sticky top-0 z-sticky flex items-baseline justify-between gap-4 rounded-t-surface border-b border-edge bg-surface px-4 py-3">
      <div>
        <h3 class="text-sm font-semibold text-ink">{{ section.label }}</h3>
        <p v-if="section.isUnrecognised" class="text-xs text-warning-700">
          This group is not one the report knows how to classify, so its money is shown here and is
          counted in neither the earned nor the spent total.
        </p>
      </div>
      <div class="text-right">
        <p class="text-base font-bold tabular-nums text-ink">{{ fmtUsd(section.total) }}</p>
        <p v-if="showToDate && section.toDateTotal !== null" class="text-2xs text-ink-tertiary tabular-nums">
          {{ fmtUsd(section.toDateTotal) }} · {{ compareLabel }}
        </p>
      </div>
    </div>

    <DataTable
      embedded
      dense
      :sticky-header="false"
      :columns="columns"
      :rows="section.lines"
      row-key="glid"
      :loading="loading"
      :expanded="expanded"
      empty-text="No accounts posted in this period."
      @row-click="toggle"
    >
      <!-- The account CODE rides beside every name, and it is load-bearing rather than decorative:
           McLeod truncates `descr` to 28 characters at source, so three revenue accounts all read
           "Gross Trucking Income" and the code is the only thing telling them apart. -->
      <template #cell-descr="{ row }">
        <span class="flex items-center gap-2">
          <BaseButton
            variant="ghost"
            size="sm"
            :aria-expanded="expanded.has(row.glid)"
            :aria-label="`${expanded.has(row.glid) ? 'Hide' : 'Show'} where account ${row.glid} was posted`"
            @click.stop="toggle(row)"
          >
            <AppIcon
              :icon="expanded.has(row.glid) ? ChevronDownIcon : ChevronRightIcon"
              class="size-4"
              aria-hidden="true"
            />
          </BaseButton>
          <span class="text-ink">{{ row.descr ?? "(no name)" }}</span>
          <span class="font-mono text-2xs text-ink-tertiary">{{ row.glid }}</span>
        </span>
      </template>

      <template #cell-amount="{ value }">
        <span class="tabular-nums" :class="value < 0 ? 'text-ink-secondary' : 'text-ink'">
          {{ fmtUsd(value) }}
        </span>
      </template>
      <template #cell-pctOfRevenue="{ value }">
        <span class="tabular-nums text-ink-tertiary">{{ fmtPct(value) }}</span>
      </template>
      <template #cell-toDateAmount="{ value }">
        <span class="tabular-nums text-ink-secondary">{{ value === null ? "—" : fmtUsd(value) }}</span>
      </template>
      <template #cell-toDatePctOfRevenue="{ value }">
        <span class="tabular-nums text-ink-tertiary">{{ fmtPct(value) }}</span>
      </template>

      <!-- Which parts of McLeod moved this money. It is the drill-down that turns "Fuel for Hired
           Vehicles $972,820.53" into "5,777 fuel-card lines", and it is the only place the page
           says anything about HOW a figure was booked. -->
      <template #expanded="{ row }">
        <div class="bg-surface-subtle px-4 py-2">
          <p class="mb-1 text-2xs uppercase tracking-wide text-ink-tertiary">
            Where this came from in McLeod
          </p>
          <ul class="space-y-0.5">
            <li
              v-for="m in row.modules"
              :key="m.post_module"
              class="flex justify-between gap-6 text-xs text-ink-secondary"
            >
              <span class="font-mono">{{ m.post_module }}</span>
              <span class="tabular-nums">
                {{ fmtUsd(m.amount) }}
                <span class="ml-2 text-ink-tertiary">{{ m.lines.toLocaleString() }} lines</span>
              </span>
            </li>
            <li v-if="!row.modules.length" class="text-xs text-ink-tertiary">
              Nothing posted in this period — the figure shown is year to date.
            </li>
          </ul>
        </div>
      </template>
    </DataTable>
  </BaseCard>
</template>
