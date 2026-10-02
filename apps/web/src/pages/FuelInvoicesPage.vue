<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { AppButton as BaseButton, AppIcon } from "@silvicom/ui";
import { ArrowUpTrayIcon } from "@silvicom/ui/icons";
import { RECON_STATUS_LABELS } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import DataTable from "@/components/ui/DataTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import CheckInvoiceDrawer from "@/features/reconcile/CheckInvoiceDrawer.vue";
import { useReconRunsQuery, type ReconRunSummaryRow } from "@/features/reconcile/useReconRuns";
import { formatDate, formatDateTime } from "@/lib/format";
import { useSessionStore } from "@/stores/session";

/**
 * Pilot invoices — every invoice check the server recorded, newest week first (FS3, D-FSV8).
 *
 * ── WHY A PAGE, AND WHY THE LIST COMES FIRST ────────────────────────────────────────────────────
 * Checking a bill used to be a drawer on Fuel Spend's Statements tab, and its answer lived in that
 * drawer. The owner's review (2026-10-01) called it unusable, and production said why: three checks
 * had been run and none could be looked at again. A check is evidence about a bill, so the page is the
 * list of them, and each one opens on what it found, read back from the server.
 *
 * ── PAGED ON THE SERVER ─────────────────────────────────────────────────────────────────────────
 * A weekly invoice is ~52 checks a year; the API counts them (`total`) and answers one page, so this
 * list never meets PostgREST's 1,000-row cap and never has to guess how many there are.
 *
 * The two "missing" columns carry D-FSV7's words. Their sum is never shown: one is money we can't
 * account for and the other is money not yet invoiced (D-FX5).
 */

const router = useRouter();
const session = useSessionStore();
const PAGE_SIZE = 25;
const page = ref(1);
const { data, isLoading, isFetching, isError, error, refetch } = useReconRunsQuery(page, PAGE_SIZE);
const checking = ref(false);

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
/** "3 · $1,285" — a count with its money, or a dash when there is nothing to explain. */
const countAndMoney = (n: number, money: number) => (n === 0 ? "—" : `${n.toLocaleString()} · ${usd(money)}`);

const rows = computed(() =>
  (data.value?.runs ?? []).map((r: ReconRunSummaryRow) => ({
    id: r.id,
    period: `${formatDate(r.period_start)} – ${formatDate(r.period_end)}`,
    source: r.source_kind === "weekly_statement" ? `Invoice ${r.invoice_no ?? "—"}` : "Monthly export",
    matched: `${(r.summary.clean + r.summary.dateDrift).toLocaleString()} of ${r.summary.reportLines.toLocaleString()}`,
    notOurs: countAndMoney(r.summary.missingInSystem, r.summary.exposure.unrecorded),
    notBilled: countAndMoney(r.summary.missingOnReport, r.summary.exposure.unbilled),
    differs: r.summary.amountMismatch === 0 ? "—" : r.summary.amountMismatch.toLocaleString(),
    checked: formatDateTime(r.created_at),
    needsLook: r.summary.missingInSystem > 0 || r.summary.amountMismatch > 0,
  })),
);

const columns: DataTableColumn[] = [
  // The invoice number sits under its week, and the bill's line count beside what matched, rather than
  // each in a column of its own: eight columns did not fit a 1440-px screen.
  { key: "period", label: "Week", width: "lg" },
  { key: "matched", label: "Matched lines", numeric: true, width: "md" },
  { key: "notOurs", label: RECON_STATUS_LABELS.missing_in_system, numeric: true, width: "lg" },
  { key: "notBilled", label: RECON_STATUS_LABELS.missing_on_report, numeric: true, width: "lg" },
  { key: "differs", label: RECON_STATUS_LABELS.amount_mismatch, numeric: true, width: "sm" },
  { key: "checked", label: "Checked", width: "md", cellClass: "text-ink-secondary" },
];

const open = (row: { id: string }) => router.push({ name: "fuel-invoice-check", params: { id: row.id } });

function onRecorded(runId: string) {
  checking.value = false;
  page.value = 1;
  void router.push({ name: "fuel-invoice-check", params: { id: runId } });
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Each Pilot invoice we checked against our own fuel records, newest week first. Open one to see every line.">
      <template #actions>
        <BaseButton v-if="session.can('fuel')" variant="primary" @click="checking = true">
          <AppIcon :icon="ArrowUpTrayIcon" class="-ml-0.5 size-5" aria-hidden="true" /> Check an invoice
        </BaseButton>
      </template>
    </PageHeader>

    <DataWorkspace>
      <FilterBar embedded :count="data?.total ?? 0" count-label="checks" />
      <DataTable
        embedded
        :columns="columns"
        :rows="rows"
        row-key="id"
        :loading="isLoading || isFetching"
        :error="isError ? (error?.message ?? 'Could not load your invoice checks') : null"
        @retry="() => refetch()"
        @row-click="open"
      >
        <template #cell-period="{ row }">
          <span class="block font-medium text-ink">{{ row.period }}</span>
          <span class="block text-xs text-ink-tertiary">{{ row.source }}</span>
        </template>
        <template #cell-notOurs="{ row }">
          <span :class="row.notOurs === '—' ? 'text-ink-tertiary' : 'font-medium text-danger-700'">{{ row.notOurs }}</span>
        </template>
        <template #empty>
          No invoices checked yet. Use <strong>Check an invoice</strong> with Pilot's weekly PDF or monthly export.
        </template>
        <template #footer>
          <TablePagination
            :page="page"
            :page-size="PAGE_SIZE"
            :total="data?.total ?? 0"
            :loading="isFetching"
            @update:page="page = $event"
          />
        </template>
      </DataTable>
    </DataWorkspace>

    <CheckInvoiceDrawer :open="checking" @close="checking = false" @recorded="onRecorded" />
  </div>
</template>
