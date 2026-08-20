<script setup lang="ts">
import { computed, ref } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { screeningFieldLabel, rolesThatManage, type ScreeningRow } from "@fuelguard/shared";
import { AppCard as BaseCard, AppButton as BaseButton, AppDateField } from "@fuelguard/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useUpdateDriverProfile } from "@/composables/useDrivers";
import {
  screeningReadinessKey,
  useScreeningReadinessQuery,
} from "@/features/recruitment/useScreeningReadiness";

/**
 * Screening readiness (PSP-PLAN P0b) — the page that answers "how many drivers can we screen".
 *
 * ── WHY IT EXISTS, MEASURED RATHER THAN GUESSED ────────────────────────────────────────────────
 * On 2026-08-20 production held 201 active drivers, a licence for 166 and a date of birth for ZERO.
 * Every PSP gate was built and the carrier number was configured; not one request could have been
 * made. The product had no screen that said so, and the per-driver identity card (P0) turned the fix
 * into a 201-visit job. This is the fleet-wide view of the same fact, with the field that is missing
 * editable in the row where it is missing.
 *
 * ── THE VERDICT COMES FROM THE VALIDATOR, NOT FROM THIS PAGE ───────────────────────────────────
 * Every "ready" here is `validatePspRequest` over a draft built by `buildPspDraft` — the same two
 * functions the order path runs. A page with its own checklist would eventually call somebody ready
 * whom PSP refuses, and PSP charges the transaction fee on Failure (§8), so the disagreement would
 * cost money to discover rather than merely being wrong.
 */
const session = useSessionStore();
const toast = useToastStore();
const qc = useQueryClient();
const readinessQ = useScreeningReadinessQuery();
const save = useUpdateDriverProfile();

const canEdit = computed(() => {
  const role = session.role;
  return Boolean(role) && rolesThatManage("recruitment").includes(role!);
});

const filter = ref("all");
const rows = computed<ScreeningRow[]>(() => {
  const all = readinessQ.data.value?.rows ?? [];
  if (filter.value === "ready") return all.filter((r) => r.ready);
  if (filter.value === "blocked") return all.filter((r) => !r.ready);
  return all;
});

const summary = computed(() => readinessQ.data.value?.summary ?? null);

/** Per-row edit state, keyed by driver id — one row saving must not blank another's input. */
const dobDraft = ref<Record<string, string>>({});

async function saveDob(row: ScreeningRow): Promise<void> {
  const value = dobDraft.value[row.driverId];
  if (!value) return;
  try {
    await save.mutateAsync({ id: row.driverId, input: { date_of_birth: value } });
    delete dobDraft.value[row.driverId];
    // The verdict is server-side, so the row's own answer has to be re-asked rather than assumed.
    void qc.invalidateQueries({ queryKey: screeningReadinessKey });
  } catch (e) {
    toast.error("Could not save the date of birth", e instanceof Error ? e.message : undefined);
  }
}

const needsDob = (row: ScreeningRow): boolean => row.gaps.some((g) => g.field === "driverDOB");

const columns: DataTableColumn[] = [
  { key: "name", label: "Driver" },
  { key: "status", label: "Status" },
  { key: "gaps", label: "What PSP would refuse" },
  { key: "dob", label: "Date of birth" },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader />

    <BaseCard v-if="summary">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 class="text-sm font-semibold text-ink">
            {{ summary.ready }} of {{ summary.drivers }} drivers can be screened
          </h2>
          <p class="mt-1 text-sm text-ink-muted">
            FMCSA PSP matches on last name, licence number, licence state and date of birth — all
            four, exactly. A driver missing any of them cannot be screened, and a request that goes
            out wrong is charged for anyway.
          </p>
        </div>
        <span
          v-if="summary.carrierSource === 'none'"
          :class="[BADGE_BASE, toneClass('danger')]"
        >
          No carrier DOT number
        </span>
      </div>

      <dl v-if="summary.blockedBy.length" class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div v-for="blocker in summary.blockedBy" :key="blocker.field" class="rounded-surface bg-surface-muted p-3">
          <dt class="text-xs font-medium text-ink-secondary">{{ screeningFieldLabel(blocker.field) }}</dt>
          <dd class="mt-1 text-lg font-bold text-ink">{{ blocker.drivers }}</dd>
          <dd class="text-xs text-ink-muted">drivers blocked</dd>
        </div>
      </dl>
      <p v-else class="mt-4 text-sm text-ink-muted">
        Nothing is missing. Every driver here has what a screening request needs.
      </p>
    </BaseCard>

    <FilterBar>
      <FilterSelect
        v-model="filter"
        label="Show"
        :options="[
          { value: 'all', label: 'Everyone' },
          { value: 'blocked', label: 'Cannot be screened' },
          { value: 'ready', label: 'Ready to screen' },
        ]"
      />
    </FilterBar>

    <BaseCard padding="none">
      <DataTable
        :columns="columns"
        :rows="rows"
        row-key="driverId"
        :loading="readinessQ.isLoading.value"
        :error="readinessQ.isError.value ? (readinessQ.error.value?.message ?? 'Could not load screening readiness.') : null"
        :retrying="readinessQ.isFetching.value"
        empty-text="No active drivers or applicants yet."
      >
        <template #cell-name="{ row }">
          <RouterLink :to="`/drivers/${row.driverId}`" class="font-medium text-ink hover:underline">
            {{ row.name }}
          </RouterLink>
        </template>
        <template #cell-status="{ row }">
          <span class="text-ink-muted">{{ row.status }}</span>
        </template>
        <template #cell-gaps="{ row }">
          <span v-if="row.ready" :class="[BADGE_BASE, toneClass('success')]">Ready</span>
          <span v-else class="text-sm text-ink-secondary">
            {{ row.gaps.map((g) => screeningFieldLabel(g.field)).join(", ") }}
          </span>
        </template>
        <template #cell-dob="{ row }">
          <div v-if="canEdit && needsDob(row)" class="flex items-center gap-2">
            <AppDateField v-model="dobDraft[row.driverId]" />
            <BaseButton
              size="sm"
              :disabled="!dobDraft[row.driverId] || save.isPending.value"
              @click="saveDob(row)"
            >
              Save
            </BaseButton>
          </div>
          <span v-else-if="needsDob(row)" class="text-ink-muted">Not recorded</span>
          <span v-else class="text-ink-muted">On file</span>
        </template>
      </DataTable>
    </BaseCard>
  </div>
</template>
