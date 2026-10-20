<script setup lang="ts">
import { computed, ref } from "vue";
import { AppCard as BaseCard, QueryState } from "@silvicom/ui";
import { INSPECTION_LEVEL_NAMES } from "@silvicom/shared";
import { useSessionStore } from "@/stores/session";
import GatedLink from "@/components/GatedLink.vue";
import { formatDate } from "@/lib/format";
import { useRoadsideInspectionsQuery, type OpenDayRange } from "./useRoadsideInspections";

/**
 * The roadside record for one unit (UNIT-FILES-PLAN UF5's Maintenance section): the inspections whose
 * report names this unit, from the same whole-record read the Roadside inspections page makes, each
 * linking to its own page where that page opens for this reader.
 *
 * Matched by what the officer WROTE — the company number or the plate on the report — because the
 * list's DTO carries the units as the report names them (D-IC7 keeps an unmatched unit in front of a
 * person rather than guessing it is ours), not the row the projection tied them to. A report that
 * misspelt the unit is therefore absent here and present on the inspections page, which is the
 * honest reading until the projection's own match is served.
 *
 * Gated on the safety section: a reader without it gets no card, and no request to be refused.
 */
const props = defineProps<{ kind: "tractor" | "trailer"; unitNumber: string; plate?: string | null }>();
const session = useSessionStore();
const maySee = computed(() => session.canView("safety"));
const wholeRecord = ref<OpenDayRange>({ from: null, to: null });
const q = useRoadsideInspectionsQuery(wholeRecord);
const inspections = computed(() =>
  (q.data.value ?? []).filter((i) =>
    (i.units ?? []).some((u) => u.kind === props.kind && (u.companyNumber === props.unitNumber || (props.plate != null && u.plate === props.plate))),
  ),
);
const level = (n: number | null) => (n !== null ? `Level ${n}${INSPECTION_LEVEL_NAMES[n] ? ` · ${INSPECTION_LEVEL_NAMES[n]}` : ""}` : "Level —");
</script>

<template>
  <BaseCard v-if="maySee" padding="none" data-test="unit-inspections">
    <h3 class="border-b border-edge-subtle px-5 py-3 text-sm font-semibold text-ink">Roadside inspections</h3>
    <div v-if="q.isPending.value || q.isError.value" class="px-5 py-3">
      <QueryState
        compact
        :loading="q.isPending.value && !q.isError.value"
        :error="q.isError.value"
        :retrying="q.isFetching.value"
        loading-text="Loading the roadside record…"
        error-text="Could not load the roadside inspections."
        @retry="q.refetch()"
      />
    </div>
    <ul v-else class="divide-y divide-edge-subtle text-sm">
      <li v-for="i in inspections" :key="i.id" class="flex items-center justify-between gap-4 px-5 py-2">
        <GatedLink :to="`/roadside-inspections/${i.id}`" class="font-medium text-link hover:text-link-hover" plain-class="font-medium text-ink">
          {{ i.inspectionDate ? formatDate(i.inspectionDate) : "Undated" }}<template v-if="i.reportState"> · {{ i.reportState }}</template>
        </GatedLink>
        <span class="shrink-0 text-xs text-ink-muted">
          {{ level(i.level) }} · {{ i.violations ?? 0 }} violation{{ i.violations === 1 ? "" : "s" }}<template v-if="i.vehicleOos"> · vehicle OOS</template>
        </span>
      </li>
      <li v-if="inspections.length === 0" class="px-5 py-3 text-ink-muted">No roadside inspection names this unit.</li>
    </ul>
  </BaseCard>
</template>
