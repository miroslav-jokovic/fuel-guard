<script setup lang="ts">
import { computed } from "vue";
import type { DueSelection, PoolPace, ProgramPerson } from "@silvicom/shared";
import { AppCallout, AppCard as BaseCard } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import QueryState from "@/components/ui/QueryState.vue";
import StatCard from "@/components/ui/StatCard.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import ProgramPeopleTable from "@/features/drugAlcohol/ProgramPeopleTable.vue";
import ResultsTable from "@/features/drugAlcohol/ResultsTable.vue";
import { useDrugAlcoholProgram } from "@/features/drugAlcohol/useDrugAlcoholProgram";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDate, formatDateTime } from "@/lib/format";

/**
 * Safety › Drug & Alcohol — the DOT program as Med-Stop holds it (MEDSTOP-PLAN.md §6 F-1/F-2, MS1;
 * results F-5, MS2c).
 *
 * Every block answers a question the 2026-10-13 live read showed nobody could answer without opening
 * Med-Stop's portal beside a roster export (§5A): who drives here and is outside the random pool,
 * who left and can still be drawn, how many tests the year still needs, and who is selected and not
 * yet tested. The order is the order of consequence — a driver outside the pool is a §382.305
 * violation today; a medical date that disagrees is a file to fix this week.
 */

const program = useDrugAlcoholProgram();
const p = computed(() => program.data.value);

const poolValue = (pool: PoolPace) => `${pool.currentPercent.toFixed(1)}%`;
const poolSub = (pool: PoolPace) => {
  const owed = pool.testsOwed === 0
    ? `Target ${pool.targetPercent}% met`
    : `${pool.testsOwed} more ${pool.testsOwed === 1 ? "test" : "tests"} needed for ${pool.targetPercent}% by ${pool.endsOn ? formatDate(pool.endsOn) : "year end"}`;
  const drawn = pool.testsOwed > 0 ? ` · ${pool.scheduledTests} drawn ahead` : "";
  const lost = pool.lostSelections > 0 ? ` · ${pool.lostSelections} ${pool.lostSelections === 1 ? "draw" : "draws"} ended untested this year` : "";
  return owed + drawn + lost;
};
// The rate itself is not good or bad until the year ends; what IS bad now is fewer draws ahead than
// tests owed, so the caption carries the colour and the value stays neutral.
const poolSubTone = (pool: PoolPace) =>
  pool.testsOwed === 0 ? "text-success-700" : pool.scheduledTests < pool.testsOwed ? "text-danger-700" : undefined;

const selectionColumns: DataTableColumn[] = [
  { key: "name", label: "Driver", cellClass: "font-medium text-ink" },
  { key: "service", label: "Test" },
  { key: "selectedOn", label: "Selected" },
  { key: "daysSince", label: "Waiting", numeric: true },
  { key: "ordered", label: "Ordered" },
];
const selectionRows = (rows: DueSelection[]) => rows.map((s) => ({ ...s, name: s.person.name, driverId: s.person.driverId }));
const testLabel = (s: DueSelection["service"]) => (s === "drug" ? "Drug" : s === "alcohol" ? "Alcohol" : "Other");

const medicalPeople = computed<ProgramPerson[]>(() => p.value?.roster.medicalDisagrees.map((m) => m.person) ?? []);
const medicalByMedstopId = computed(() => new Map((p.value?.roster.medicalDisagrees ?? []).map((m) => [m.person.medstopId, m])));
const medicalText = (person: ProgramPerson) => {
  const m = medicalByMedstopId.value.get(person.medstopId);
  return m ? `Ours ${m.ours ? formatDate(m.ours) : "none"} · Med-Stop ${m.medstop ? formatDate(m.medstop) : "none"}` : "";
};
</script>

<template>
  <div class="space-y-6">
    <PageHeader>
      The DOT drug and alcohol program as Med-Stop holds it, checked against the drivers here every hour.
    </PageHeader>

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
          Med-Stop is not connected yet. An admin connects it under Settings › Med-Stop integration; until then this page has nothing to compare.
        </AppCallout>
        <AppCallout v-else-if="p.lastError" tone="caution">
          The last read from Med-Stop failed, so these lists are from {{ p.syncedAt ? formatDateTime(p.syncedAt) : "an earlier read" }}: {{ p.lastError.slice(0, 200) }}
        </AppCallout>

        <div v-if="p.pools.length > 0" class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <StatCard
            v-for="pool in p.pools"
            :key="pool.service + pool.poolYear"
            :label="`${pool.label} random rate, ${pool.poolYear}`"
            :value="poolValue(pool)"
            :sub-tone="poolSubTone(pool)"
            :sub="poolSub(pool)"
          />
        </div>

        <!-- MS2c (F-5): results come first — a positive is a driver who may not drive today. Only
             admins and safety managers receive `results`; for everyone else it is null. -->
        <template v-if="p.results">
          <ResultsTable
            title="Results to review"
            why="Positive, refused, dilute or unrecognised results from Med-Stop in the last year. A positive or refusal keeps the driver off dispatch until a return-to-duty record dated on or after the test is on file."
            :rows="p.results.recent"
            empty-text="No results need review."
          />
          <ResultsTable
            v-if="p.results.history.length > 0"
            title="Found on the first read from Med-Stop"
            why="Positives and refusals from before this product was watching. Nothing was done with them automatically: check each driver is either gone or has a return-to-duty record on file."
            :rows="p.results.history"
            empty-text=""
          />
        </template>

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

        <template v-if="p.selections">
          <BaseCard as="section" padding="none">
            <div class="px-6 pt-5 pb-3">
              <h2 class="text-sm font-semibold text-ink">
                Selected, not yet tested <span class="ml-1 font-normal text-ink-muted">{{ p.selections.due.length }}</span>
              </h2>
              <p class="mt-1 text-xs text-ink-muted">
                A selected driver goes for the test as soon as they are told. Only admins and safety managers see this list,
                so no one can warn a driver ahead.
              </p>
            </div>
            <DataTable embedded dense :sticky-header="false" :columns="selectionColumns" :rows="selectionRows(p.selections.due)" row-key="selectionId" empty-text="No one is waiting on a random test.">
              <template #cell-name="{ row }">
                <RouterLink v-if="row.driverId" :to="{ name: 'driver-detail', params: { id: row.driverId } }" class="text-brand-700 hover:underline">{{ row.name }}</RouterLink>
                <span v-else>{{ row.name }}</span>
              </template>
              <template #cell-service="{ row }">{{ testLabel(row.service) }}</template>
              <template #cell-selectedOn="{ row }">{{ formatDate(row.selectedOn) }}</template>
              <template #cell-daysSince="{ row }">{{ row.daysSince === 0 ? "today" : `${row.daysSince} d` }}</template>
              <template #cell-ordered="{ row }">
                <span :class="[BADGE_BASE, toneClass(row.ordered ? 'info' : 'warning')]">{{ row.ordered ? "Ordered" : "Not ordered" }}</span>
              </template>
            </DataTable>
          </BaseCard>
          <p v-if="p.selections.upcoming.length > 0" class="text-xs text-ink-muted">
            {{ p.selections.upcoming.length }} more {{ p.selections.upcoming.length === 1 ? "selection falls" : "selections fall" }} in the next 7 days.
          </p>
        </template>

        <ProgramPeopleTable
          title="Licence Med-Stop has, our file lacks"
          why="Matched by name. Med-Stop holds a licence number for each of these drivers; add it to the driver's file here."
          :people="p.roster.licenceWeLack"
          empty-text="Every matched driver has a licence number on file."
        />
        <ProgramPeopleTable
          title="Medical card dates disagree"
          why="Our current medical certificate and Med-Stop's record give different expiry dates. Check the card and correct whichever is wrong."
          :people="medicalPeople"
          :detail="medicalText"
          detail-label="Expiry"
          empty-text="Medical card dates agree."
        />

        <p class="text-xs text-ink-muted">
          {{ p.roster.matched }} of {{ p.roster.medstopActive }} people on Med-Stop's active roster are matched to a driver here.
          <template v-if="p.syncedAt">Read from Med-Stop {{ formatDateTime(p.syncedAt) }}.</template>
        </p>
      </template>
    </QueryState>
  </div>
</template>
