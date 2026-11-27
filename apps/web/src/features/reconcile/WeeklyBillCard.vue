<script setup lang="ts">
import { computed } from "vue";
import { AppCallout, AppCard as BaseCard, DataTable, QueryState, StatCard, type DataTableColumn } from "@silvicom/ui";
import ExportButton from "@/components/ExportButton.vue";
import { formatDate } from "@/lib/format";
import { useWeeklyBillQuery } from "./useWeeklyBill";
import { usd2 } from "./format";

/**
 * The weekly Pilot bill in the OLD statement's columns, on the invoice check it belongs to
 * (PILOT-INVOICE-FORMAT-ANALYSIS-2026-11-24 §3).
 *
 * Pilot's 2026-11 invoice stopped printing the discount: no Fuel Cost, no Retail Total, no Savings Total.
 * The office read the week's savings off those, so this card puts back the totals the old statement
 * printed and the one check the old one never had — lines billed above Pilot's own quote that day. The
 * full statement, every line in the old column order, is the Excel download; the page shows only what a
 * person decides from.
 *
 * A check whose statement was never recorded (every check before 2026-11-24 in production — the save was
 * refused and only a toast said so) has nothing to rebuild, and says that in words rather than as zeros.
 */
const props = defineProps<{ statementId: string | null }>();
const id = computed(() => props.statementId ?? "");
const { data, isLoading, isError, error, isFetching, refetch } = useWeeklyBillQuery(id);

const report = computed(() => data.value?.report ?? null);
const statement = computed(() => data.value?.statement ?? null);
const overQuoteUsd = computed(() => (report.value?.overQuote ?? []).reduce((a, r) => a + (r.overQuoteUsd ?? 0), 0));
const printedDiffers = computed(() => {
  const s = statement.value;
  const r = report.value;
  return s && r && s.printed.amount != null && Math.abs(s.printed.amount - r.totals.invoiceTotal) > 0.011;
});

const columns: DataTableColumn[] = [
  { key: "date", label: "Date", width: "sm", cellClass: "text-ink-secondary" },
  { key: "store", label: "Store", width: "md", cellClass: "text-ink-secondary" },
  { key: "unit", label: "Unit", width: "sm", cellClass: "text-ink-secondary" },
  { key: "units", label: "Gallons", numeric: true, width: "sm" },
  { key: "billed", label: "Billed $/gal", numeric: true, width: "sm" },
  { key: "quote", label: "Pilot quote $/gal", numeric: true, width: "sm" },
  { key: "over", label: "Over the quote", numeric: true, width: "md" },
];
const dayColumns: DataTableColumn[] = [
  { key: "date", label: "Date", width: "sm", cellClass: "text-ink-secondary" },
  { key: "units", label: "Gallons", numeric: true, width: "sm" },
  { key: "amount", label: "Fuel amount", numeric: true, width: "md" },
  { key: "avg", label: "Avg $/gal", numeric: true, width: "sm" },
  { key: "invoice", label: "Invoice total", numeric: true, width: "md" },
  { key: "savings", label: "Savings", numeric: true, width: "md" },
];
const gal = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const perGal = (n: number | null) => (n == null ? "—" : `$${n.toFixed(4)}`);
// The old statement's day blocks: Date Subtotal, Average Cost Per Gallon and Savings SubTotal per day. The average
// is fuel $ ÷ gallons and can differ from Pilot's printed day figure by up to about a cent (weeklyBillReport.ts).
const dayRows = computed(() =>
  (report.value?.byDay ?? []).map((d) => ({
    id: d.date ?? "undated",
    date: d.date ? formatDate(d.date) : "No date",
    units: gal(d.units),
    amount: usd2(d.amount),
    avg: perGal(d.avgCostPerGal),
    invoice: usd2(d.invoiceTotal),
    savings: usd2(d.savings),
  })),
);
const overRows = computed(() =>
  (report.value?.overQuote ?? []).map((r, i) => ({
    id: `${i}-${r.ticket ?? ""}`,
    date: formatDate(r.date),
    store: [r.site, r.city, r.state].filter(Boolean).join(" "),
    unit: r.unit ?? "—",
    units: r.units.toLocaleString("en-US", { maximumFractionDigits: 2 }),
    billed: r.fuelCost == null ? "—" : `$${r.fuelCost.toFixed(4)}`,
    quote: r.quotedPrice == null ? "—" : `$${r.quotedPrice.toFixed(4)}`,
    over: `${usd2(r.overQuoteUsd ?? 0)} (+$${(r.overQuotePerGal ?? 0).toFixed(4)}/gal)`,
  })),
);
</script>

<template>
  <BaseCard>
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 class="text-sm font-semibold text-ink">Weekly bill in the old columns</h3>
        <p class="mt-1 text-sm text-ink-muted">
          The totals Pilot's statement used to print — retail, savings, per product — rebuilt from the bill's own
          lines, and every diesel line checked against that store's quote from Pilot's daily price file.
        </p>
      </div>
      <ExportButton
        v-if="statementId && statement"
        :href="`/api/fueling/statements/${encodeURIComponent(statementId)}/weekly-bill.xlsx`"
        :filename="`pilot-${statement.invoiceNo}-${statement.periodStart}-old-columns.xlsx`"
        :scope="`${(report?.rows.length ?? 0).toLocaleString()} lines · old column order`"
        label="Download statement (Excel)"
      />
    </div>

    <AppCallout v-if="!statementId" tone="caution" class="mt-3">
      The statement itself was not saved with this check, so there is nothing to rebuild. Upload the same PDF
      again on the Pilot invoices page: it is checked and saved in one go, and this card fills in.
    </AppCallout>

    <QueryState
      v-else
      :loading="isLoading"
      :error="isError ? error : null"
      :retrying="isFetching"
      loading-text="Rebuilding the statement…"
      error-text="Could not load the statement."
      not-found-text="That statement is no longer on record."
      @retry="refetch()"
    >
      <template v-if="report && statement">
        <div class="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Invoice total" :value="usd2(report.totals.invoiceTotal)" :sub="`${report.rows.length.toLocaleString()} lines`" />
          <StatCard label="Retail total" :value="usd2(report.totals.retailTotal)" sub="what the pump price would have cost" />
          <StatCard label="Savings" :value="usd2(report.totals.savings)" sub="retail − invoice" tone="success" />
          <StatCard
            label="Billed above Pilot's quote"
            :value="report.overQuote.length ? usd2(overQuoteUsd) : 'None'"
            :sub="`${report.overQuote.length} line${report.overQuote.length === 1 ? '' : 's'} of ${usd2(report.quote.floorUsd)} or more`"
            :tone="report.overQuote.length ? 'danger' : undefined"
          />
        </div>

        <p class="mt-3 text-xs text-ink-tertiary">
          {{ report.quote.quoted.toLocaleString() }} of {{ report.quote.tractorLines.toLocaleString() }} truck-diesel lines
          checked against Pilot's quote<template v-if="report.quote.unquoted">; {{ report.quote.unquoted.toLocaleString() }}
          had no quote for that store on that day or the day before</template>. Reefer and DEF are not on Pilot's
          price file, so they are not checked.
        </p>
        <AppCallout v-if="printedDiffers" tone="caution" class="mt-3">
          These lines add up to {{ usd2(report.totals.invoiceTotal) }}, but Pilot printed {{ usd2(statement.printed.amount) }}.
        </AppCallout>

        <ul class="mt-4 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <li v-for="p in report.byProduct" :key="p.code" class="flex justify-between gap-3">
            <span class="text-ink-secondary">{{ p.code === "merchandise" ? "In-store items" : `${p.code} Customer Total` }}</span>
            <span class="tabular-nums text-ink">
              {{ p.units ? `${p.units.toLocaleString("en-US", { maximumFractionDigits: 1 })} gal · ` : "" }}{{ usd2(p.amount) }}
              <span v-if="p.savings" class="text-success-700"> · saved {{ usd2(p.savings) }}</span>
            </span>
          </li>
        </ul>

        <div v-if="dayRows.length" class="mt-4" data-test="weekly-bill-days">
          <h4 class="text-sm font-medium text-ink">By day</h4>
          <DataTable embedded class="mt-2" :columns="dayColumns" :rows="dayRows" row-key="id" empty-text="No lines." />
          <p class="mt-2 text-xs text-ink-tertiary">
            Average cost per gallon for the week: <strong class="text-ink">{{ perGal(report.totals.avgCostPerGal) }}</strong>
            ({{ gal(report.totals.units) }} gal). Averages are fuel dollars ÷ gallons; Pilot's own printed day average
            can differ by up to about a cent.
          </p>
        </div>

        <div v-if="overRows.length" class="mt-4">
          <h4 class="text-sm font-medium text-ink">Billed above Pilot's quote · {{ formatDate(statement.periodStart) }} – {{ formatDate(statement.periodEnd) }}</h4>
          <DataTable embedded class="mt-2" :columns="columns" :rows="overRows" row-key="id" empty-text="None." />
        </div>
      </template>
    </QueryState>
  </BaseCard>
</template>
