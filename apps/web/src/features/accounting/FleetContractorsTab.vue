<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from "vue";
import { useRoute } from "vue-router";
import { useQueryState, DataWorkspace, FilterBar } from "@silvicom/ui";
import CpmOwnerOperatorTable from "./CpmOwnerOperatorTable.vue";
import FleetSplitCard from "./FleetSplitCard.vue";
import type { FleetReportResponse, OwnerOperatorRow } from "./useFleetReport";

/**
 * The contractors tab of the fleet report, lifted out of the page at R1 of the UI plan. The rows are
 * the fleet report's own (`ownerOperators`, D-FLEET7): their trucks come from `payee_type`, their
 * pay from the settlements, their revenue from the loads they ran, and `dealPct` is read back from
 * pay ÷ revenue on their own orders — never configured.
 *
 * The headline is prose rather than two cards, because the two numbers are a sentence: what they
 * hauled, and what of it we kept. The tab owns its page number. The period is the page's, chosen
 * once on the rail above the tabs (D-FRUI1); `from`/`to` arrive only so a period change resets the
 * page number.
 *
 * The page number lives in the URL under this tab's own scope, `contractors.page` (D-US2): every tab
 * of the fleet report shares one route, so an unscoped `?page=` would be page 4 of whichever tab
 * read it next. Scoped, page 4 of the contractors is still not page 4 of anything else (owner ruling
 * 2026-08-29), and a reload keeps it; leaving for another tab clears it, see below.
 */

const props = defineProps<{
  ownerOperators: OwnerOperatorRow[];
  /** The whole report, for the company / contractor split that leads this tab since R4 (D-FRUI6). */
  report: FleetReportResponse | null;
  loading: boolean;
  error: string | null;
  from: string;
  to: string;
}>();

const PAGE_SIZE = 20;
const qs = useQueryState("contractors");
const page = qs.page();
// Leaving this tab for ANOTHER TAB clears its whole scope, which is what remounting used to do
// for free: a tab's page and filters reset on a tab change (owner ruling 2026-08-29), and D-US2 put
// them somewhere that outlives the mount. Leaving the ROUTE clears nothing — the route has already
// changed by the time this runs, and the history entry Back returns to still carries the list.
const route = useRoute();
const ownPath = route.path;
onBeforeUnmount(() => route.path === ownPath && qs.set({ page: undefined }));
watch([() => props.from, () => props.to], () => (page.value = 1));

const revenue = computed(() => props.ownerOperators.reduce((a, o) => a + o.revenue, 0));
const margin = computed(() => props.ownerOperators.reduce((a, o) => a + o.netMargin, 0));
const pageRows = computed(() => props.ownerOperators.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

const fmtUsd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });
</script>

<template>
  <div class="space-y-6">
    <FleetSplitCard v-if="report && report.monthsCovered.length" :report="report" />

    <p v-if="ownerOperators.length" class="text-sm text-ink-secondary">
      Contractors hauled <span class="font-semibold text-ink">{{ fmtUsd(revenue) }}</span> in this
      period, of which we kept <span class="font-semibold text-ink">{{ fmtUsd(margin) }}</span
      >. They are paid a share of each load, so they carry no share of the company's costs.
    </p>

    <DataWorkspace>
      <FilterBar embedded :count="ownerOperators.length" count-label="contractors" />

      <CpmOwnerOperatorTable
        :rows="pageRows"
        :page="page"
        :total="ownerOperators.length"
        :page-size="PAGE_SIZE"
        :loading="loading"
        :error="error"
        @update:page="page = $event"
      />
    </DataWorkspace>
  </div>
</template>
