<script setup lang="ts">
import { AppIcon } from "@fuelguard/ui";
import {
  ArrowUpTrayIcon,
} from "@fuelguard/ui/icons";
import { ref, computed } from "vue";
import { reconcilePilotFuel, DEFAULT_TOLERANCES, type ReconStatus } from "@fuelguard/shared";
import { loadFuelReport, ReportLoadError, type LoadedReport } from "@/features/reconcile/loadFuelReport";
import { useSaveStatement, StatementRejected } from "@/features/reconcile/useSaveStatement";
import { useSystemFillsQuery, type ReconWindow } from "@/features/reconcile/useFuelReconcile";
import { useToastStore } from "@/stores/toast";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { AppCard as BaseCard } from "@fuelguard/ui";
import { AppButton as BaseButton } from "@fuelguard/ui";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";

/**
 * Upload a vendor report and reconcile it against our own records — line by line.
 *
 * Any Pilot / Flying J report is accepted: the weekly direct-bill statement PDF, or the monthly
 * "All Transactions" export as .xlsx/.csv/.xls. `loadFuelReport` normalises all of them, so nothing
 * here branches on file type, and a weekly statement must reproduce its own printed totals to the cent
 * before a single number from it is shown.
 *
 * This was the whole page until WP6. It is now one tab of it: reconciliation answers "does this file
 * match what we recorded", which is a different question from "what is fuel costing us and why", and
 * the second one needs the statements that were kept rather than the file just dropped.
 */

const toast = useToastStore();
const saveStatement = useSaveStatement();
const emit = defineEmits<{ saved: [] }>();
const report = ref<LoadedReport | null>(null);
const parsing = ref(false);
const fileName = computed(() => report.value?.fileName ?? null);
const saved = ref(false);

const window = computed<ReconWindow | null>(() =>
  report.value?.startDate && report.value?.endDate ? { from: report.value.startDate, to: report.value.endDate } : null,
);
const { data: systemFills, isLoading: fillsLoading, isError, error } = useSystemFillsQuery(window);

/** What the discount actually saved against posted retail — the statement carries both sides per line. */
const savings = computed(() => {
  const r = report.value;
  if (!r || !r.totalRetail) return null;
  return r.totalRetail - r.totalNet;
});

const result = computed(() =>
  report.value ? reconcilePilotFuel(report.value.fills, systemFills.value ?? [], DEFAULT_TOLERANCES) : null,
);

async function onFiles(files: File[]) {
  const file = files[0];
  if (!file) return;
  parsing.value = true;
  try {
    const loaded = await loadFuelReport(file);
    report.value = loaded;
    for (const note of loaded.tieOut?.notes ?? []) toast.info("Statement note", note);
    toast.success(
      `Loaded ${loaded.fills.length.toLocaleString()} diesel fills`,
      `${loaded.kind === "weekly_statement" ? `Invoice ${loaded.invoiceNumber ?? "—"}` : `Account ${loaded.account ?? "—"}`} · ${loaded.startDate} → ${loaded.endDate}`,
    );
    // Keeping the statement is what makes week-over-week possible; the reconciliation below renders
    // either way, so a save failure never costs the user the parse they are already looking at.
    if (loaded.statementSource) await persist(loaded);
  } catch (e) {
    if (e instanceof ReportLoadError) toast.error(e.message, e.detail);
    else toast.error("Could not read the report", e instanceof Error ? e.message : undefined);
  } finally {
    parsing.value = false;
  }
}
/** Record the statement server-side. The server re-parses, so this can still be refused. */
async function persist(loaded: LoadedReport) {
  if (!loaded.statementSource) return;
  try {
    const r = await saveStatement.mutateAsync({
      words: loaded.statementSource.words,
      bytes: loaded.statementSource.bytes,
      filename: loaded.fileName,
    });
    saved.value = true;
    emit("saved");
    const replaced = r.supersededStatementId ? " · replaced the earlier version of this invoice" : "";
    toast.success("Statement saved", `${r.lines?.toLocaleString()} lines kept for week-over-week${replaced}`);
    if (r.unresolvedSites?.length) {
      toast.warning(
        `${r.unresolvedSites.length} site${r.unresolvedSites.length === 1 ? "" : "s"} not in the station registry`,
        `Their lines are kept without a brand rather than guessed: ${r.unresolvedSites.slice(0, 5).join(", ")}`,
      );
    }
  } catch (e) {
    if (e instanceof StatementRejected) toast.error("Statement not saved", [e.message, ...e.reasons].join(" "));
    else toast.error("Statement not saved", e instanceof Error ? e.message : undefined);
  }
}

function reset() {
  report.value = null;
  saved.value = false;
  statusFilter.value = "discrepancies";
}

const fmtUsd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtUsd2 = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" }));
const fmtGal = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 1 }));

// Summary tiles (each filters the table when clicked).
type Bucket = { key: ReconStatus | "discrepancies"; label: string; value: number; tone: string; hint: string };
const buckets = computed<Bucket[]>(() => {
  const s = result.value?.summary;
  if (!s) return [];
  const disc = s.missingInSystem + s.missingOnReport + s.amountMismatch + s.gallonMismatch + s.other;
  return [
    { key: "discrepancies", label: "Discrepancies", value: disc, tone: disc ? "text-danger-700 bg-danger-50 ring-danger-100" : "text-ink-muted bg-surface-muted ring-edge", hint: `${fmtUsd(s.dollarsAtStake)} at stake` },
    { key: "missing_in_system", label: "Missing in our system", value: s.missingInSystem, tone: "text-danger-700 bg-danger-50 ring-danger-100", hint: "on report, no fill" },
    { key: "missing_on_report", label: "Missing on report", value: s.missingOnReport, tone: "text-caution-800 bg-caution-50 ring-caution-100", hint: "fill, no report line" },
    { key: "amount_mismatch", label: "Amount mismatch", value: s.amountMismatch, tone: "text-warning-800 bg-warning-50 ring-warning-100", hint: "$ differs" },
    { key: "gallon_mismatch", label: "Gallon mismatch", value: s.gallonMismatch, tone: "text-warning-800 bg-warning-50 ring-warning-100", hint: "gallons differ" },
    { key: "clean", label: "Matched clean", value: s.clean, tone: "text-success-700 bg-success-50 ring-success-100", hint: "reconciled" },
  ];
});

const statusFilter = ref<ReconStatus | "discrepancies" | "">("discrepancies");
const statusOptions = [
  { value: "discrepancies", label: "Discrepancies only" },
  { value: "", label: "All rows" },
  { value: "missing_in_system", label: "Missing in our system" },
  { value: "missing_on_report", label: "Missing on report" },
  { value: "amount_mismatch", label: "Amount mismatch" },
  { value: "gallon_mismatch", label: "Gallon mismatch" },
  { value: "other", label: "Other" },
  { value: "clean", label: "Matched clean" },
];
const STATUS_LABEL: Record<ReconStatus, string> = {
  clean: "Clean", amount_mismatch: "Amount", gallon_mismatch: "Gallons",
  missing_in_system: "Missing (system)", missing_on_report: "Missing (report)", other: "Other",
};
const statusTone = (s: ReconStatus): string => {
  if (s === "clean") return "bg-success-50 text-success-700";
  if (s === "missing_in_system") return "bg-danger-50 text-danger-700";
  if (s === "missing_on_report") return "bg-caution-50 text-caution-800";
  return "bg-warning-50 text-warning-800";
};

const DISCREPANCY: ReconStatus[] = ["missing_in_system", "missing_on_report", "amount_mismatch", "gallon_mismatch", "other"];
const rows = computed(() => {
  const all = result.value?.rows ?? [];
  const f = statusFilter.value;
  const kept = !f ? all : f === "discrepancies" ? all.filter((r) => DISCREPANCY.includes(r.status)) : all.filter((r) => r.status === f);
  return kept.map((r, i) => {
    const rep = r.report;
    const sys = r.system;
    return {
      id: `${i}-${rep?.authNo ?? sys?.id ?? i}`,
      status: r.status,
      date: rep?.tranDate ?? sys?.tranDate ?? "—",
      unit: rep?.unit ?? sys?.unit ?? "—",
      site: rep ? [rep.site, rep.city, rep.state].filter(Boolean).join(" ") : "—",
      card: (rep?.cardRef ?? sys?.cardRef ?? "").slice(-4) || "—",
      repGal: rep?.gallons ?? null,
      sysGal: sys?.gallons ?? null,
      repAmt: rep?.netAmount ?? null,
      sysAmt: sys?.totalCost ?? null,
      note: r.note ?? "",
    };
  });
});

const columns: DataTableColumn[] = [
  { key: "status", label: "Status", width: "lg" },
  { key: "date", label: "Date", width: "sm", cellClass: "text-ink-secondary" },
  { key: "unit", label: "Unit", width: "sm", cellClass: "text-ink-secondary" },
  { key: "site", label: "Site", width: "lg", cellClass: "text-ink-secondary" },
  { key: "card", label: "Card", width: "xs", cellClass: "text-ink-secondary" },
  { key: "gallons", label: "Gallons (rpt / sys)", numeric: true, width: "md" },
  { key: "amount", label: "Amount (rpt / sys)", numeric: true, width: "lg" },
  { key: "note", label: "Detail", width: "xl", cellClass: "text-ink-secondary" },
];
</script>

<template>
  <div class="space-y-6">
    <div v-if="report" class="flex justify-end">
      <BaseButton variant="ghost" @click="reset">Upload another</BaseButton>
    </div>

    <!-- Upload -->
    <BaseCard v-if="!report">
      <div class="flex items-start gap-3">
        <AppIcon :icon="ArrowUpTrayIcon" class="mt-0.5 size-5 shrink-0 text-ink-tertiary" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <h3 class="text-sm font-semibold text-ink">Vendor fuel report</h3>
          <p class="mt-1 text-sm text-ink-muted">
            Either Pilot / Flying J report, in any format we're sent it: the weekly direct-bill statement
            (PDF) or the monthly "All Transactions" export (.xlsx, .csv, or .xls). We match each diesel fill
            to your recorded fuel by card, date, gallons and amount, and flag anything that doesn't line up.
          </p>
          <p class="mt-1 text-xs text-ink-tertiary">
            A weekly statement is checked against the totals Pilot prints on it. If our reading doesn't
            reproduce them to the cent, we reject the file rather than show you numbers we can't stand behind.
          </p>
          <div class="mt-3">
            <FileDropzone accept=".pdf,.xls,.xlsx,.xlsm,.csv,.htm,.html" :disabled="parsing" @files="onFiles" />
          </div>
          <p v-if="parsing" class="mt-3 text-sm text-ink-secondary">Reading the report…</p>
        </div>
      </div>
    </BaseCard>

    <template v-else>
      <!-- Report meta -->
      <BaseCard padding="sm">
        <div class="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span class="font-medium text-ink">{{ fileName }}</span>
          <span :class="[BADGE_BASE, report.tieOut ? toneClass('success') : toneClass('neutral')]">
            {{ report.kind === "weekly_statement" ? "Weekly statement" : "Monthly export" }}
          </span>
          <span class="text-ink-muted">
            {{ report.invoiceNumber ? `Invoice ${report.invoiceNumber}` : `Account ${report.account ?? "—"}` }}
          </span>
          <span class="text-ink-muted">{{ report.startDate }} → {{ report.endDate }}</span>
          <span class="text-ink-muted">{{ report.fills.length.toLocaleString() }} diesel fills · {{ fmtGal(report.totalGallons) }} gal · {{ fmtUsd(report.totalNet) }} paid</span>
          <span v-if="savings != null" class="text-ink-muted">{{ fmtUsd(savings) }} saved vs retail</span>
          <span v-if="report.reeferLines.length" class="text-ink-muted">{{ report.reeferLines.length }} reefer</span>
          <span v-if="report.defLines.length" class="text-ink-muted">{{ report.defLines.length }} DEF</span>
          <span v-if="report.merchandise.length" class="text-ink-muted">{{ report.merchandise.length }} in-store</span>
          <span v-if="report.tieOut" class="text-success-700">Ties to the statement's own totals</span>
          <span v-if="saveStatement.isPending.value" class="text-ink-tertiary">· saving…</span>
          <span v-else-if="saved" class="text-ink-muted">· saved</span>
          <span v-if="fillsLoading" class="text-ink-tertiary">· matching your fills…</span>
        </div>
      </BaseCard>

      <p v-if="isError" class="rounded-surface bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-100">
        Couldn't load your recorded fills: {{ error instanceof Error ? error.message : "unknown error" }}
      </p>

      <!-- Summary tiles -->
      <dl class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <BaseButton
          v-for="b in buckets"
          :key="b.key"
          type="button"
          class="rounded-dialog px-4 py-3 text-left ring-1 transition"
          :class="[b.tone, (statusFilter === b.key || (b.key === 'discrepancies' && statusFilter === 'discrepancies')) ? 'ring-2' : '']"
          @click="statusFilter = b.key"
        >
          <dt class="text-xs font-medium uppercase tracking-wide opacity-80">{{ b.label }}</dt>
          <dd class="mt-1 text-2xl font-bold">{{ b.value.toLocaleString() }}</dd>
          <dd class="mt-0.5 text-xs opacity-80">{{ b.hint }}</dd>
        </BaseButton>
      </dl>

      <FilterBar :count="rows.length" count-label="rows">
        <template #filters>
          <FilterSelect v-model="statusFilter" label="Show" :options="statusOptions" />
        </template>
      </FilterBar>

      <DataTable
        :columns="columns"
        :rows="rows"
        row-key="id"
        :loading="fillsLoading"
        empty-text="No rows in this bucket."
      >
        <template #cell-status="{ row }">
          <span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium" :class="statusTone(row.status as ReconStatus)">
            {{ STATUS_LABEL[row.status as ReconStatus] }}
          </span>
        </template>
        <template #cell-gallons="{ row }">
          <span class="tabular-nums">{{ fmtGal(row.repGal) }}</span>
          <span class="text-ink-tertiary"> / {{ fmtGal(row.sysGal) }}</span>
        </template>
        <template #cell-amount="{ row }">
          <span class="tabular-nums">{{ fmtUsd2(row.repAmt) }}</span>
          <span class="text-ink-tertiary"> / {{ fmtUsd2(row.sysAmt) }}</span>
        </template>
        <template #cell-note="{ row }">{{ row.note }}</template>
      </DataTable>
    </template>
  </div>
</template>
