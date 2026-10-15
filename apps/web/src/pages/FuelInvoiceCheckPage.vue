<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { AppCallout, AppCard as BaseCard } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import { QueryState } from "@silvicom/ui";
import ReconResultView from "@/features/reconcile/ReconResultView.vue";
import { useReconRunQuery } from "@/features/reconcile/useReconRuns";
import { formatDate, formatDateTime } from "@/lib/format";

/**
 * One saved invoice check (FS3, D-FSV8): what it was checked against, and every line it found.
 *
 * Read from `GET /api/fueling/recon-runs/:id` exactly as it was recorded; the browser never re-runs
 * the matcher, so this is the same page whether it is opened a minute after the upload or a year
 * later. A check that a later upload of the same invoice replaced still opens, and says so.
 */

const route = useRoute();
const id = computed(() => String(route.params.id ?? ""));
const { data, isLoading, isError, error, isFetching, refetch } = useReconRunQuery(id);

const run = computed(() => data.value?.run ?? null);
const title = computed(() => {
  const r = run.value;
  if (!r) return "";
  const what = r.source_kind === "weekly_statement" ? `Invoice ${r.invoice_no ?? "—"}` : "Monthly export";
  return `${what} · ${formatDate(r.period_start)} – ${formatDate(r.period_end)}`;
});
const exportName = computed(() => {
  const r = run.value;
  return r ? `pilot-${r.invoice_no ?? "export"}-${r.period_start}-to-${r.period_end}` : "pilot-check";
});
</script>

<template>
  <div class="space-y-6">
    <PageHeader :description="title || 'An invoice check, as it was recorded.'" />

    <QueryState
      :loading="isLoading"
      :error="isError ? error : null"
      :retrying="isFetching"
      loading-text="Loading the check…"
      error-text="Could not load that invoice check."
      not-found-text="There's no invoice check with that link. It may belong to another company, or the link is incomplete."
      @retry="refetch()"
    >
      <template v-if="data && run">
        <AppCallout v-if="run.superseded_by" tone="caution">
          This invoice was checked again on {{ formatDateTime(run.superseded_at) }}; the newer check is the one
          on the Pilot invoices list. This one is kept as it was.
        </AppCallout>

        <BaseCard padding="sm">
          <div class="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span class="font-medium text-ink">{{ run.source_filename ?? "Uploaded file" }}</span>
            <span class="text-ink-muted">{{ run.summary.reportLines.toLocaleString() }} lines on the bill</span>
            <span class="text-ink-muted">{{ run.summary.systemFills.toLocaleString() }} fills in our records</span>
            <span v-if="run.unmatchable_lines" class="text-ink-muted">
              {{ run.unmatchable_lines.toLocaleString() }} DEF and in-store lines set aside
            </span>
            <span :class="run.tie_out_gated ? 'text-success-700' : 'text-ink-muted'">
              {{ run.tie_out_gated ? "Matches the totals Pilot printed" : "No printed totals to compare with" }}
            </span>
            <span class="text-ink-tertiary">Checked {{ formatDateTime(run.created_at) }}</span>
          </div>
          <ul v-if="run.tie_out_notes.length" class="mt-2 space-y-0.5 text-xs text-ink-tertiary">
            <li v-for="n in run.tie_out_notes" :key="n">{{ n }}</li>
          </ul>
        </BaseCard>

        <ReconResultView :summary="run.summary" :rows="data.lines" :export-name="exportName" />
      </template>
    </QueryState>
  </div>
</template>
