<script setup lang="ts">
import { computed } from "vue";
import { AppCallout, AppTabs } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import QueryState from "@/components/ui/QueryState.vue";
import InProgressTab from "@/features/drugAlcohol/InProgressTab.vue";
import MedicalTab from "@/features/drugAlcohol/MedicalTab.vue";
import ProgramPeopleTable from "@/features/drugAlcohol/ProgramPeopleTable.vue";
import RandomTab from "@/features/drugAlcohol/RandomTab.vue";
import ResultsTab from "@/features/drugAlcohol/ResultsTab.vue";
import { useDrugAlcoholProgram } from "@/features/drugAlcohol/useDrugAlcoholProgram";
import { useQueryState } from "@/composables/useQueryState";
import { formatDateTime } from "@/lib/format";

/**
 * Safety › Drug & Alcohol (MEDSTOP-PLAN.md §7A, MS-UX1) — five tabs, one per job, after the owner's
 * review of the first version found it confusing: random selections to act on, tests in progress,
 * results, medical cards running out, and the two roster violations.
 *
 * The house queue-list pattern (DESIGN-SYSTEM-CONTRACT §5.1 #2): `AppTabs` with counts, the tab in the
 * URL. Each count is the length of the list under it (R5), and an empty list shows none (AppTabs: omit, not 0). Random and Results exist only for the
 * roles the API sends them to (admin, safety_manager) — a tab nobody may open is not drawn.
 */
const program = useDrugAlcoholProgram();
const p = computed(() => program.data.value);
const qs = useQueryState();

const tabs = computed(() => {
  const d = p.value;
  if (!d) return [];
  return [
    ...(d.selections ? [{ value: "random", label: "Random selections", badge: d.selections.due.length || undefined }] : []),
    { value: "progress", label: "In progress", badge: d.inProgress.length || undefined },
    ...(d.results ? [{ value: "results", label: "Results", badge: d.results.recent.length || undefined }] : []),
    { value: "medical", label: "Medical cards", badge: d.medical.due.length || undefined },
    { value: "roster", label: "Roster check", badge: d.roster.notInPool.length + d.roster.leftButInPool.length || undefined },
  ];
});
const tab = computed({
  get: () => {
    const asked = qs.one("tab");
    return tabs.value.some((t) => t.value === asked) ? asked! : (tabs.value[0]?.value ?? "progress");
  },
  set: (v: string) => qs.set({ tab: v === tabs.value[0]?.value ? undefined : v }),
});

// R1: say how fresh the data is, and warn when it is not — an hourly sweep that has stopped must not
// look like a quiet week.
const STALE_MS = 2 * 60 * 60 * 1000;
const stale = computed(() => {
  const at = p.value?.syncedAt ? Date.parse(p.value.syncedAt) : NaN;
  return !Number.isFinite(at) || Date.now() - at > STALE_MS;
});
</script>

<template>
  <div class="space-y-6">
    <PageHeader>Random selections, tests in progress, results and medical cards, read from Med-Stop every hour.</PageHeader>

    <QueryState
      :loading="program.isLoading.value && !p"
      :error="program.isError.value ? (program.error.value ?? true) : null"
      :retrying="program.isFetching.value"
      loading-text="Loading the program…"
      error-text="Could not load the drug and alcohol program."
      @retry="program.refetch()"
    >
      <template v-if="p">
        <AppCallout v-if="!p.connected" tone="info">
          Med-Stop is not connected yet. An admin connects it under Settings › Med-Stop integration; until then this page has nothing to show.
        </AppCallout>
        <AppCallout v-else-if="p.lastError" tone="caution">
          The last read from Med-Stop failed, so this is from {{ p.syncedAt ? formatDateTime(p.syncedAt) : "an earlier read" }}: {{ p.lastError.slice(0, 200) }}
        </AppCallout>
        <AppCallout v-else-if="stale" tone="caution">
          {{ p.syncedAt ? `Last read from Med-Stop ${formatDateTime(p.syncedAt)} — more than two hours ago, so this may be out of date.` : "Med-Stop has not been read yet. The first read runs within the hour." }}
        </AppCallout>
        <p v-else class="text-xs text-ink-muted">Read from Med-Stop {{ formatDateTime(p.syncedAt!) }}.</p>

        <AppTabs v-model="tab" :tabs="tabs" label="Drug and alcohol" scrollable />

        <RandomTab v-if="tab === 'random' && p.selections" :due="p.selections.due" :reserves="p.selections.reserves" :pools="p.pools" />
        <InProgressTab v-else-if="tab === 'progress'" :rows="p.inProgress" />
        <ResultsTab v-else-if="tab === 'results' && p.results" :recent="p.results.recent" :history="p.results.history" />
        <MedicalTab v-else-if="tab === 'medical'" :medical="p.medical" />
        <div v-else-if="tab === 'roster'" class="space-y-6">
          <ProgramPeopleTable
            title="Driving here, not in Med-Stop's random pool"
            why="Every active DOT driver must be in the random pool (49 CFR 382.305). Add each one in Med-Stop, or end their employment here if they no longer drive."
            :people="p.roster.notInPool"
            empty-text="Every active driver is in Med-Stop's pool."
          />
          <ProgramPeopleTable
            title="In Med-Stop's pool, no longer driving here"
            why="Med-Stop can still select these people. Terminate them in Med-Stop. A name with no link is someone Med-Stop lists that no driver here matches."
            :people="p.roster.leftButInPool"
            empty-text="Med-Stop's pool holds no one who has left."
          />
        </div>
      </template>
    </QueryState>
  </div>
</template>
