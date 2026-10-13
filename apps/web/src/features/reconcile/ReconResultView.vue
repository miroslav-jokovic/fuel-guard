<script setup lang="ts">
import { computed, watch } from "vue";
import { AppCallout, AppCard as BaseCard } from "@silvicom/ui";
import { RECON_DISCREPANCIES, RECON_STATUS_LABELS, type ReconRow, type ReconStatus, type ReconSummary } from "@silvicom/shared";
import { BADGE_BASE, toneClass, reconStatusBadge } from "@/lib/badges";
import { formatDate } from "@/lib/format";
import FilterBar from "@/components/ui/FilterBar.vue";
import StatCard from "@/components/ui/StatCard.vue";
import FactList, { type Fact } from "@/components/ui/FactList.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable from "@/components/ui/DataTable.vue";
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import ExportButton from "@/components/ExportButton.vue";
import TablePagination from "@/components/TablePagination.vue";
import { downloadCsv } from "@/lib/csv";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import { useQueryState } from "@/composables/useQueryState";

/**
 * What one invoice check found — the counts, the money and the lines — as the SERVER recorded it.
 *
 * Moved out of the upload drawer in FS3 (D-FSV8). The drawer used to hold the result in a component
 * ref, so closing it lost the only copy anybody could see (W5). This view takes what `GET
 * /api/fueling/recon-runs/:id` returns and nothing else: it never runs the matcher, so a check opened
 * a month later shows what was found that day, not a fresh match against fills that have moved since.
 *
 * `rows: null` is a check whose lines were not kept (everything recorded before 0406). It is said in
 * words, because an empty table under "1 on Pilot's bill, not in our records" reads as a contradiction.
 */
const props = defineProps<{
  summary: ReconSummary;
  rows: ReconRow[] | null;
  /** Names the CSV, e.g. `invoice-800157197-2026-09-14`. */
  exportName: string;
}>();

const fmtUsd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtUsd2 = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" }));
const fmtGal = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 1 }));

// Summary tiles (each filters the table when clicked).
/** `tone` colours the hint under a non-zero count; a zero is muted rather than alarming. */
type Bucket = { key: ReconStatus | "discrepancies"; label: string; value: number; tone: string; hint: string };
const buckets = computed<Bucket[]>(() => {
  const s = props.summary;
  const disc = s.missingInSystem + s.missingOnReport + s.amountMismatch + s.gallonMismatch + s.other;
  return [
    { key: "discrepancies", label: "Needs a look", value: disc, tone: "text-danger-700", hint: disc ? "lines below" : "nothing to explain" },
    { key: "missing_in_system", label: RECON_STATUS_LABELS.missing_in_system, value: s.missingInSystem, tone: "text-danger-700", hint: fmtUsd(s.exposure.unrecorded) },
    { key: "missing_on_report", label: RECON_STATUS_LABELS.missing_on_report, value: s.missingOnReport, tone: "text-caution-800", hint: fmtUsd(s.exposure.unbilled) },
    { key: "amount_mismatch", label: RECON_STATUS_LABELS.amount_mismatch, value: s.amountMismatch, tone: "text-warning-800", hint: `${fmtUsd(s.exposure.overbilled)} over · ${fmtUsd(s.exposure.underbilled)} under` },
    { key: "date_drift", label: RECON_STATUS_LABELS.date_drift, value: s.dateDrift, tone: "text-ink-secondary", hint: "one fill, not two findings" },
    { key: "clean", label: RECON_STATUS_LABELS.clean, value: s.clean, tone: "text-success-700", hint: "reconciled" },
  ];
});

/**
 * The four kinds of money, apart — and never their sum (D-FX5).
 *
 * Money we can recover, money we may owe, and money nobody has explained are different findings; a
 * $50 overbill and a $50 underbill are not $100 of exposure. The two missing kinds carry §5's words.
 */
const exposure = computed(() => {
  const e = props.summary.exposure;
  return [
    { key: "overbilled", label: "Billed above what we recorded", value: e.overbilled, lines: e.overbilledLines, tone: "text-danger-700", hint: "recoverable" },
    { key: "underbilled", label: "Billed below what we recorded", value: e.underbilled, lines: e.underbilledLines, tone: undefined, hint: "may still be owed" },
    { key: "unrecorded", label: RECON_STATUS_LABELS.missing_in_system, value: e.unrecorded, lines: e.unrecordedLines, tone: "text-danger-700", hint: "fuel we cannot account for" },
    { key: "unbilled", label: RECON_STATUS_LABELS.missing_on_report, value: e.unbilled, lines: e.unbilledLines, tone: undefined, hint: "not yet invoiced" },
  ].filter((x) => x.lines > 0);
});
/** The same four as FactList facts (D-US6); each value's line count and hint ride in its slot. */
const exposureFacts = computed<Fact[]>(() =>
  exposure.value.map((x) => ({ key: x.key, label: x.label, value: fmtUsd(x.value), tone: x.tone, numeric: true })),
);

/** How each match was placed. A claim's strength is part of the claim. */
const matchBasis = computed(() => {
  const s = props.summary;
  const total = s.matchedOnCard6 + s.matchedOnCard4 + s.matchedOnDateGallons;
  if (total === 0) return null;
  const parts: string[] = [];
  if (s.matchedOnCard6) parts.push(`${s.matchedOnCard6.toLocaleString()} on the card's last six digits`);
  if (s.matchedOnCard4) parts.push(`${s.matchedOnCard4} on the last four only — a weaker match`);
  if (s.matchedOnDateGallons) parts.push(`${s.matchedOnDateGallons} on date and gallons, with no card agreement`);
  return parts.join(", ");
});

/**
 * Every row as CSV. A check exists to be taken to somebody — accounting, or Pilot — and the clean
 * rows go too, because they are the evidence that the rest were looked for.
 */
function exportRows() {
  if (!props.rows) return;
  downloadCsv(
    props.exportName,
    ["Status", "Matched on", "Date (Pilot)", "Date (ours)", "Days apart", "Unit", "Site", "Card",
     "Gallons (Pilot)", "Gallons (ours)", "Amount (Pilot)", "Amount (ours)", "Amount difference", "Tank", "Detail"],
    props.rows.map((x) => [
      RECON_STATUS_LABELS[x.status], x.basis ?? "",
      formatDate(x.report?.tranDate, ""), formatDate(x.system?.tranDate, ""), x.dayDelta ?? "",
      x.report?.unit ?? x.system?.unit ?? "",
      x.report ? [x.report.site, x.report.city, x.report.state].filter(Boolean).join(" ") : "",
      (x.report?.cardRef ?? x.system?.cardRef ?? "").slice(-6),
      x.report?.gallons ?? "", x.system?.gallons ?? "",
      x.report?.netAmount ?? "", x.system?.totalCost ?? "", x.amountDelta ?? "",
      x.tank, x.note ?? "",
    ]),
  );
}

const statusOptions = [
  { value: "discrepancies", label: "Needs a look" },
  { value: "", label: "All rows" },
  ...(Object.keys(RECON_STATUS_LABELS) as ReconStatus[]).map((k) => ({ value: k, label: RECON_STATUS_LABELS[k] })),
];

// "Needs a look" is where a check OPENS, so it is the default rather than a narrowing: counting it
// would put "Clear filters" on every freshly opened check, and pressing it would widen nothing.
const DEFAULT_STATUS_FILTER = "discrepancies" as const;

/**
 * The line filter and the page live in the URL (D-US2), so a check forwarded to accounting as "look at
 * the amount differences" opens on them, and a reload keeps the page.
 *
 * Scoped `lines.` because this view sits INSIDE the check's detail page, whose route is the page's own;
 * an unscoped `?status=` there would be a word the page never chose. "Needs a look" is the fallback, so
 * a plain link to a check stays plain and opens where a check opens; "All rows" is written as `any`.
 * The allowed words are the options' own values, so a hand-edited status the check does not know opens
 * on "Needs a look" rather than on an empty table.
 */
const qs = useQueryState("lines");
const statusFilter = qs.param(
  "status",
  statusOptions.map((o) => o.value).filter(Boolean),
  DEFAULT_STATUS_FILTER,
);
const activeFilterCount = computed(() => (statusFilter.value === DEFAULT_STATUS_FILTER ? 0 : 1));
function resetFilters() {
  qs.set({ status: undefined });
}

const tableRows = computed(() => {
  const all = props.rows ?? [];
  const f = statusFilter.value;
  const kept = !f ? all : f === "discrepancies" ? all.filter((r) => RECON_DISCREPANCIES.includes(r.status)) : all.filter((r) => r.status === f);
  return kept.map((r, i) => {
    const rep = r.report;
    const sys = r.system;
    return {
      id: `${i}-${rep?.authNo ?? sys?.id ?? i}`,
      status: r.status,
      date: formatDate(rep?.tranDate ?? sys?.tranDate),
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

/** Paged, because "All rows" on a monthly export is thousands of rows into the DOM in one pass (X12). */
const PAGE_SIZE = 50;
const page = qs.page();
// Narrowing while on page nine lands on an empty page that reads as an error rather than a filter.
watch([statusFilter, () => props.rows], () => { page.value = 1; });
const pageRows = computed(() => tableRows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

// The card's last four sit under the unit rather than in a column: with nine, the Detail column — the
// one saying by how much — ran off a 1440-px screen.
const columns: DataTableColumn[] = [
  { key: "status", label: "Status", width: "lg" },
  { key: "date", label: "Date", width: "sm", cellClass: "text-ink-secondary" },
  { key: "unit", label: "Unit · card", width: "sm", cellClass: "text-ink-secondary" },
  { key: "site", label: "Site", width: "md", cellClass: "text-ink-secondary" },
  { key: "gallons", label: "Gallons (Pilot / ours)", numeric: true, width: "md" },
  { key: "amount", label: "Amount (Pilot / ours)", numeric: true, width: "lg" },
  // Detail alone wraps: it is the matcher's own sentence ("On the report; no matching fill recorded.")
  // and was clipped at the screen edge on one line. The table's `nowrap` is inherited, so the cell's own
  // class wins without wrapping the status badges and headers with it.
  { key: "note", label: "Detail", width: "xl", cellClass: "text-ink-secondary whitespace-normal" },
];
</script>

<template>
  <div class="space-y-6">
    <!-- The counts are FILTERS: `StatCard`'s toggle mode, as CompliancePage's strip, carrying the
         pressed state in `aria-pressed` and the ring (D-UI5). They were AppButtons holding three
         stacked spans, which the button's own pill shape squeezed into one overlapping line — seen in
         a browser in FS3, invisible to every test. Inert when the lines were not kept: there is
         nothing beneath them to filter. -->
    <div role="group" aria-label="Filter the check by what it found" class="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
      <StatCard
        v-for="b in buckets"
        :key="b.key"
        :label="b.label"
        :value="b.value.toLocaleString()"
        :sub="b.hint"
        :sub-tone="b.value > 0 ? b.tone : undefined"
        :muted="b.value === 0"
        :pressed="rows == null ? undefined : statusFilter === b.key"
        @toggle="statusFilter = b.key"
      />
    </div>

    <BaseCard v-if="exposure.length" padding="sm">
      <h4 class="text-sm font-semibold text-ink">What does not reconcile</h4>
      <FactList :facts="exposureFacts" class="mt-3" data-testid="recon-exposure">
        <template v-for="x in exposure" :key="x.key" #[`value-${x.key}`]="{ fact }">
          {{ fact.value }}
          <span class="block text-xs font-normal text-ink-tertiary">{{ x.lines }} line{{ x.lines === 1 ? "" : "s" }} · {{ x.hint }}</span>
        </template>
      </FactList>
      <p class="mt-3 text-xs text-ink-tertiary">
        Reported apart on purpose: money we can recover, money we may owe, and money nobody has
        explained are different findings and are never added together.
      </p>
    </BaseCard>

    <p v-if="matchBasis" class="text-xs text-ink-tertiary">Matched {{ matchBasis }}.</p>

    <AppCallout v-if="rows == null" tone="info">
      The lines weren't kept for this check — it was recorded before checks kept them, so only its
      totals are on file. Check the invoice again to see every line.
    </AppCallout>

    <DataWorkspace v-else>
      <FilterBar
        embedded
        :count="tableRows.length"
        count-label="lines"
        :active-count="activeFilterCount"
        @clear-all="resetFilters"
      >
        <template #filters>
          <FilterSelect v-model="statusFilter" label="Show" :options="statusOptions" />
        </template>
        <template #actions>
          <ExportButton
            :run="exportRows"
            :scope="`${(rows?.length ?? 0).toLocaleString()} lines`"
            label="Download every line (CSV)"
          />
        </template>
      </FilterBar>

      <DataTable embedded :columns="columns" :rows="pageRows" row-key="id" empty-text="No lines in this group.">
        <template #cell-status="{ row }">
          <span :class="[BADGE_BASE, toneClass(reconStatusBadge(String(row.status)).tone)]">
            {{ reconStatusBadge(String(row.status)).label }}
          </span>
        </template>
        <template #cell-unit="{ row }">
          <span class="block">{{ row.unit }}</span>
          <span class="block text-xs text-ink-tertiary">…{{ row.card }}</span>
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
          <TablePagination :page="page" :page-size="PAGE_SIZE" :total="tableRows.length" @update:page="page = $event" />
        </template>
      </DataTable>
    </DataWorkspace>
  </div>
</template>
