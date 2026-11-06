<script setup lang="ts">
/**
 * "Failed background jobs" on Settings › Data & sync (E5, 2026-11-06; ADS-RUNBOOK Gap 2). The API has kept every
 * job that ran out of retries since 2026-09-21 (`GET /api/jobs/failed`, `modules/org/routes/jobs.ts`), and no page
 * rendered it: a failed spend pull, lead check or Samsara sync was a row nobody in the office could see.
 *
 * ── WHY HERE, NOT A PAGE OF ITS OWN ──────────────────────────────────────────────────────────────
 * Data & sync is already where the office checks whether background work ran: the sync cards (`useJob`) and the
 * feed freshness card. A failed job is the other half of the same question. A new route would have meant a
 * second place to look, a catalogue entry and a Settings card for one table.
 *
 * ── WHO ──────────────────────────────────────────────────────────────────────────────────────────
 * The page's gate (`admin.settings.data`, `settings: manage`) is stricter than the endpoint's (`settings`
 * view), so anyone who sees this card may read it. Neither is restated here.
 *
 * ── WORDS ────────────────────────────────────────────────────────────────────────────────────────
 * Every job's name, area, what it was for and what to do come from the shared catalogue
 * (`jobKindCatalogue.ts`), never from a list in this file. The server's own error text is kept, under the
 * hint, as the detail an engineer asks for.
 */
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";
import { AppCard as BaseCard, DataTable, type DataTableColumn } from "@silvicom/ui";
import { JOB_AREA_LABELS, jobItem, jobKindEntry } from "@silvicom/shared";
import { formatDateTime } from "@/lib/format";

/** The columns this card reads from a job row (`jobs`, 0027 + 0095). */
interface FailedJob {
  id: string;
  kind: string;
  error: string | null;
  attempts: number | null;
  max_attempts: number | null;
  payload: Record<string, unknown> | null;
  finished_at: string | null;
  created_at: string;
}

const query = useQuery({
  queryKey: ["jobs", "failed"],
  queryFn: async (): Promise<FailedJob[]> => {
    const res = await apiFetch<FailedJob[]>("/api/jobs/failed?limit=50");
    if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not read the failed jobs");
    // An answer that is not a list is this card's failure, drawn with its Retry, never a throw in render that
    // takes the rest of Data & sync down with it (found by DataSyncPage.test.ts's dispatcher, 2026-11-06).
    if (!Array.isArray(res.data)) throw new Error("The failed jobs answer was not a list");
    return res.data;
  },
});

const rows = computed(() =>
  (query.data.value ?? []).map((j) => {
    const entry = jobKindEntry(j.kind);
    return {
      id: j.id,
      what: entry.label,
      area: JOB_AREA_LABELS[entry.area],
      hint: entry.hint ?? null,
      when: formatDateTime(j.finished_at ?? j.created_at),
      attempts: j.attempts === null ? "—" : j.max_attempts ? `${j.attempts} of ${j.max_attempts}` : String(j.attempts),
      item: jobItem(j.kind, j.payload),
      error: j.error?.trim() || "No error text was recorded.",
    };
  }),
);

const columns: DataTableColumn[] = [
  { key: "what", label: "What failed", width: "xl" },
  { key: "when", label: "When", cellClass: "whitespace-nowrap" },
  { key: "attempts", label: "Tries", numeric: true, cellClass: "whitespace-nowrap" },
  // The why is sentences: it wraps, so the table never scrolls sideways to hide what to do (browser pass, 1280 px).
  { key: "error", label: "Why", width: "2xl" },
];
</script>

<template>
  <BaseCard>
    <h3 class="text-sm font-semibold text-ink">Failed background jobs</h3>
    <p class="mt-1 text-sm text-ink-muted">
      Work the system runs on its own that failed every try it was allowed. Most run again by themselves on
      their next schedule; the newest 50 are listed here, newest first.
    </p>
    <div class="mt-4">
      <DataTable
        embedded
        :columns="columns"
        :rows="rows"
        row-key="id"
        :nowrap="false"
        :loading="query.isLoading.value"
        :error="query.isError.value ? 'Could not load the failed jobs.' : null"
        :retrying="query.isFetching.value"
        empty-text="No background job has failed."
        @retry="query.refetch()"
      >
        <template #cell-what="{ row }">
          <span class="text-ink">{{ row.what }}</span>
          <span class="block text-xs text-ink-tertiary">
            {{ row.area }}<template v-if="row.item"> · {{ row.item.noun }} <span class="font-mono" :title="row.item.id">{{ row.item.id.slice(0, 8) }}</span></template>
          </span>
        </template>
        <template #cell-error="{ row }">
          <span v-if="row.hint" class="block text-sm text-ink-secondary">{{ row.hint }}</span>
          <span class="block break-words text-xs text-ink-tertiary">{{ row.error }}</span>
        </template>
      </DataTable>
    </div>
  </BaseCard>
</template>
