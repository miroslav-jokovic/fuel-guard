<script setup lang="ts">
import { AppIcon } from "@fuelguard/ui";
import {
  ArrowUpTrayIcon,
} from "@fuelguard/ui/icons";
import { ref, computed, watch } from "vue";
import { RECON_DISCREPANCIES, RECON_STATUS_LABELS, type ReconResult, type ReconStatus } from "@fuelguard/shared";
import { useRunReconciliation, ReconRejected } from "@/features/reconcile/useReconRuns";
import { readPivotSheet, readReportGrid } from "@/lib/reportGrid";
import { loadFuelReport, ReportLoadError, type LoadedReport } from "@/features/reconcile/loadFuelReport";
import { useSaveStatement, StatementRejected } from "@/features/reconcile/useSaveStatement";
import { useToastStore } from "@/stores/toast";
import { BADGE_BASE, toneClass, reconStatusBadge } from "@/lib/badges";
import { AppCard as BaseCard } from "@fuelguard/ui";
import { AppButton as BaseButton } from "@fuelguard/ui";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable from "@/components/ui/DataTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import { downloadCsv } from "@/lib/csv";
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
const runRecon = useRunReconciliation();
const emit = defineEmits<{ saved: [] }>();
const report = ref<LoadedReport | null>(null);
const parsing = ref(false);
const fileName = computed(() => report.value?.fileName ?? null);
const saved = ref(false);

// The org's fills are read SERVER-side now: the reconciliation is computed where the service role is,
// so the browser no longer pages `fuel_transactions` at all. `useFuelReconcile` stays for callers that
// still want the projection; this tab is not one of them.

/** What the discount actually saved against posted retail — the statement carries both sides per line. */
const savings = computed(() => {
  const r = report.value;
  if (!r || !r.totalRetail) return null;
  return r.totalRetail - r.totalNet;
});

/**
 * The reconciliation, as the SERVER computed and recorded it.
 *
 * This tab used to run the matcher itself and lose the answer when the tab changed. Now it decodes the
 * file — only a browser has `pdfjs` and ExcelJS — and posts the words or the grid; the server
 * re-parses, gates, reads our fills with the service role, matches and writes a `fuel_recon_runs` row.
 * What comes back is what was recorded, so what is on screen and what is in the database cannot differ.
 */
const runResult = ref<ReconResult | null>(null);
const runId = ref<string | null>(null);
const tieOutNotes = ref<string[]>([]);
const result = computed(() => runResult.value);

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
    let statementId: string | null = null;
    if (loaded.statementSource) statementId = await persist(loaded);
    // An export's PivotTable is a SECOND sheet, and it holds the printed total the server's tie-out
    // gate checks the parse against — the check the export never had (L8).
    const pivotGrid = loaded.statementSource ? null : await readPivotSheet(file);
    await reconcile(loaded, file, statementId, pivotGrid);
  } catch (e) {
    if (e instanceof ReportLoadError) toast.error(e.message, e.detail);
    else toast.error("Could not read the report", e instanceof Error ? e.message : undefined);
  } finally {
    parsing.value = false;
  }
}
/** Record the statement server-side. The server re-parses, so this can still be refused. */
async function persist(loaded: LoadedReport): Promise<string | null> {
  if (!loaded.statementSource) return null;
  let statementId: string | null = null;
  try {
    const r = await saveStatement.mutateAsync({
      words: loaded.statementSource.words,
      bytes: loaded.statementSource.bytes,
      filename: loaded.fileName,
    });
    saved.value = true;
    statementId = r.statementId ?? null;
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
  return statementId;
}

/**
 * Post the decoded report and render the run the server recorded.
 *
 * A refusal here is not a transport failure — it means the file did not reproduce its own printed
 * totals — so the gate's reasons are shown verbatim. That refusal now applies to the monthly export
 * as well as the weekly statement, which is the asymmetry L8 named: the format producing the LARGER
 * reconciliation was the one with no check at all.
 */
async function reconcile(loaded: LoadedReport, file: File, statementId: string | null, pivotGrid: unknown[][] | null) {
  try {
    const r = await runRecon.mutateAsync({
      words: loaded.statementSource?.words ?? null,
      grid: loaded.statementSource ? null : ((await readReportGrid(file)) as unknown[][]),
      pivotGrid,
      filename: loaded.fileName,
      statementId,
    });
    runResult.value = r.result ?? null;
    runId.value = r.runId ?? null;
    tieOutNotes.value = r.tieOutNotes ?? [];
    for (const n of tieOutNotes.value) toast.info("Report note", n);
    toast.success("Reconciliation recorded", `${r.periodStart} → ${r.periodEnd} · kept for good`);
  } catch (e) {
    runResult.value = null;
    if (e instanceof ReconRejected) toast.error("That report didn't add up", [e.message, ...e.reasons].join(" "));
    else toast.error("Could not reconcile the report", e instanceof Error ? e.message : undefined);
  }
}

function reset() {
  report.value = null;
  runResult.value = null;
  runId.value = null;
  tieOutNotes.value = [];
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
    { key: "discrepancies", label: "Needs a look", value: disc, tone: disc ? "text-danger-700 bg-danger-50 ring-danger-100" : "text-ink-muted bg-surface-muted ring-edge", hint: disc ? "rows below" : "nothing to explain" },
    { key: "missing_in_system", label: RECON_STATUS_LABELS.missing_in_system, value: s.missingInSystem, tone: "text-danger-700 bg-danger-50 ring-danger-100", hint: fmtUsd(s.exposure.unrecorded) },
    { key: "missing_on_report", label: RECON_STATUS_LABELS.missing_on_report, value: s.missingOnReport, tone: "text-caution-800 bg-caution-50 ring-caution-100", hint: fmtUsd(s.exposure.unbilled) },
    { key: "amount_mismatch", label: RECON_STATUS_LABELS.amount_mismatch, value: s.amountMismatch, tone: "text-warning-800 bg-warning-50 ring-warning-100", hint: `${fmtUsd(s.exposure.overbilled)} over · ${fmtUsd(s.exposure.underbilled)} under` },
    { key: "date_drift", label: RECON_STATUS_LABELS.date_drift, value: s.dateDrift, tone: "text-ink-secondary bg-surface-muted ring-edge", hint: "one fill, not two findings" },
    { key: "clean", label: RECON_STATUS_LABELS.clean, value: s.clean, tone: "text-success-700 bg-success-50 ring-success-100", hint: "reconciled" },
  ];
});

/**
 * The four kinds of money, apart — and never their sum.
 *
 * This was one figure called "dollars at stake" that added the amount deltas, the full value of lines
 * we never recorded, and the full value of fills the vendor never billed. Those are money we can
 * recover, money we may owe, and money nobody has explained; adding them produces a number that is
 * always too big and means nothing. A $50 overbill and a $50 underbill are not $100 of exposure.
 */
const exposure = computed(() => {
  const e = result.value?.summary.exposure;
  if (!e) return [];
  return [
    { label: "Billed above what we recorded", value: e.overbilled, lines: e.overbilledLines, tone: "text-danger-700", hint: "recoverable" },
    { label: "Billed below what we recorded", value: e.underbilled, lines: e.underbilledLines, tone: "text-ink", hint: "may still be owed" },
    { label: "Billed, never recorded", value: e.unrecorded, lines: e.unrecordedLines, tone: "text-danger-700", hint: "fuel we cannot account for" },
    { label: "Recorded, never billed", value: e.unbilled, lines: e.unbilledLines, tone: "text-ink", hint: "not yet invoiced" },
  ].filter((x) => x.lines > 0);
});

/**
 * The run's rows as CSV — the only tab on this page that never had one.
 *
 * A reconciliation exists to be taken to somebody: accounting, or the vendor. Until F5 it could not
 * leave the screen at all, which is why a discrepancy found on a Tuesday was re-found from scratch on
 * the Thursday. Every row goes, not only the discrepancies, because the clean ones are the evidence
 * that the rest were looked for.
 */
function exportRun() {
  const r = result.value;
  if (!r) return;
  downloadCsv(
    `fuel-reconciliation-${report.value?.startDate ?? ""}-to-${report.value?.endDate ?? ""}`,
    ["Status", "Matched on", "Date (report)", "Date (ours)", "Days apart", "Unit", "Site", "Card",
     "Gallons (report)", "Gallons (ours)", "Amount (report)", "Amount (ours)", "Amount difference", "Tank", "Detail"],
    r.rows.map((x) => [
      RECON_STATUS_LABELS[x.status], x.basis ?? "",
      x.report?.tranDate ?? "", x.system?.tranDate ?? "", x.dayDelta ?? "",
      x.report?.unit ?? x.system?.unit ?? "",
      x.report ? [x.report.site, x.report.city, x.report.state].filter(Boolean).join(" ") : "",
      (x.report?.cardRef ?? x.system?.cardRef ?? "").slice(-6),
      x.report?.gallons ?? "", x.system?.gallons ?? "",
      x.report?.netAmount ?? "", x.system?.totalCost ?? "", x.amountDelta ?? "",
      x.tank, x.note ?? "",
    ]),
  );
}

/** How each match was placed. A claim's strength is part of the claim. */
const matchBasis = computed(() => {
  const s = result.value?.summary;
  if (!s) return null;
  const total = s.matchedOnCard6 + s.matchedOnCard4 + s.matchedOnDateGallons;
  if (total === 0) return null;
  const parts: string[] = [];
  if (s.matchedOnCard6) parts.push(`${s.matchedOnCard6.toLocaleString()} on the card's last six digits`);
  if (s.matchedOnCard4) parts.push(`${s.matchedOnCard4} on the last four only — a weaker match`);
  if (s.matchedOnDateGallons) parts.push(`${s.matchedOnDateGallons} on date and gallons, with no card agreement`);
  return parts.join(", ");
});

const statusFilter = ref<ReconStatus | "discrepancies" | "">("discrepancies");
const statusOptions = [
  { value: "discrepancies", label: "Needs a look" },
  { value: "", label: "All rows" },
  ...(Object.keys(RECON_STATUS_LABELS) as ReconStatus[]).map((k) => ({ value: k, label: RECON_STATUS_LABELS[k] })),
];

const rows = computed(() => {
  const all = result.value?.rows ?? [];
  const f = statusFilter.value;
  const kept = !f ? all : f === "discrepancies" ? all.filter((r) => RECON_DISCREPANCIES.includes(r.status)) : all.filter((r) => r.status === f);
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

/**
 * X12 — the table is paged.
 *
 * `DataTable` renders what it is given, and this was given every row: a monthly export covers two
 * months and runs to thousands, all of them into the DOM in one pass. The buckets above narrow it,
 * but "All rows" is one click away and was the case nobody had tried.
 */
const PAGE_SIZE = 50;
const page = ref(1);
// Narrowing while on page nine lands on an empty page that reads as an error rather than a filter.
watch([statusFilter, result], () => { page.value = 1; });
const pageRows = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

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
    <div v-if="report" class="flex flex-wrap items-center justify-end gap-2">
      <span v-if="runId" class="text-xs text-ink-tertiary">Recorded — this reconciliation is kept.</span>
      <BaseButton v-if="result" variant="ghost" @click="exportRun">Download every row (CSV)</BaseButton>
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
          <span v-if="runRecon.isPending.value" class="text-ink-tertiary">· reconciling…</span>
        </div>
      </BaseCard>

      <p v-if="runRecon.isError.value && !result" class="rounded-surface bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-100">
        {{ runRecon.error.value instanceof Error ? runRecon.error.value.message : "Could not reconcile that report." }}
      </p>

      <!-- Summary tiles -->
      <!-- These are FILTERS, not a description list.
           They were buttons sitting as direct children of a `dl`, each wrapping a `dt` and two `dd`s —
           markup a description list does not admit, so a screen reader was handed a broken list where
           the page meant a row of toggles. And the only signal that one was active was a ring class,
           which says nothing to anybody not looking at it. A toggle group says what it is and which
           member is pressed.
           (The angle brackets are spelled out above on purpose: `lint:ui-adoption` greps for a raw
           button tag and cannot tell prose from markup, and weakening the gate to fit a comment
           explaining the gate would be the wrong way round.) -->
      <div role="group" aria-label="Filter the reconciliation by what it found" class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <BaseButton
          v-for="b in buckets"
          :key="b.key"
          type="button"
          :aria-pressed="statusFilter === b.key"
          class="rounded-dialog px-4 py-3 text-left ring-1 transition"
          :class="[b.tone, statusFilter === b.key ? 'ring-2' : '']"
          @click="statusFilter = b.key"
        >
          <span class="block text-xs font-medium uppercase tracking-wide opacity-80">{{ b.label }}</span>
          <span class="mt-1 block text-2xl font-bold">{{ b.value.toLocaleString() }}</span>
          <span class="mt-0.5 block text-xs opacity-80">{{ b.hint }}</span>
        </BaseButton>
      </div>

      <!-- The four kinds of money, apart. One figure that added them was always too big and meant
           nothing; a $50 overbill and a $50 underbill are not $100 of exposure. -->
      <BaseCard v-if="exposure.length" padding="sm">
        <h4 class="text-sm font-semibold text-ink">What does not reconcile</h4>
        <dl class="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div v-for="x in exposure" :key="x.label">
            <dt class="text-xs text-ink-muted">{{ x.label }}</dt>
            <dd class="text-lg font-semibold" :class="x.tone">{{ fmtUsd(x.value) }}</dd>
            <dd class="text-2xs text-ink-tertiary">{{ x.lines }} row{{ x.lines === 1 ? "" : "s" }} · {{ x.hint }}</dd>
          </div>
        </dl>
        <p class="mt-3 text-2xs text-ink-tertiary">
          Reported apart on purpose: money we can recover, money we may owe, and money nobody has
          explained are different findings and must not be added.
        </p>
      </BaseCard>

      <p v-if="matchBasis" class="text-xs text-ink-tertiary">Matched {{ matchBasis }}.</p>

      <FilterBar :count="rows.length" count-label="rows">
        <template #filters>
          <FilterSelect v-model="statusFilter" label="Show" :options="statusOptions" />
        </template>
      </FilterBar>

      <DataTable
        :columns="columns"
        :rows="pageRows"
        row-key="id"
        :loading="runRecon.isPending.value"
        empty-text="No rows in this bucket."
      >
        <template #cell-status="{ row }">
          <span :class="[BADGE_BASE, toneClass(reconStatusBadge(String(row.status)).tone)]">
            {{ reconStatusBadge(String(row.status)).label }}
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
        <template #footer>
          <TablePagination :page="page" :page-size="PAGE_SIZE" :total="rows.length" @update:page="page = $event" />
        </template>
      </DataTable>
    </template>
  </div>
</template>
