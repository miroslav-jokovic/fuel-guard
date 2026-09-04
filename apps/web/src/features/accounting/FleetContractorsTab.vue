<script setup lang="ts">
import { computed, ref, watch } from "vue";
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
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
 * hauled, and what of it we kept. The tab owns its page number and is mounted fresh on every tab
 * change, which is what resets paging between tabs. The period is the page's, chosen once on the
 * rail above the tabs (D-FRUI1); `from`/`to` arrive only so a period change resets the page number.
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
const page = ref(1);
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
