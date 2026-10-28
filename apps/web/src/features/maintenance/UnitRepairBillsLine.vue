<script setup lang="ts">
import { computed, ref } from "vue";
import { QueryState } from "@silvicom/ui";
import { fmtMoney } from "@/lib/chartTheme";
import { ymd } from "@/lib/dateWindow";
import { useUnitRepairBillsQuery } from "./useUnitShop";

/**
 * The money on the truck's page, in one line (FleetPal F10: "the coverage ratio is on the page beside
 * the money, not behind a tooltip"). It reads F9b's endpoint, which refuses without the ledger's
 * coverage bound (D-FP4) — so the line either prints the figure WITH "at least N% of the ledger's
 * maintenance seen" (D-FP15) or prints the refusal, and never a number alone.
 *
 * Last twelve full months, the window a shop manager means by "what has this truck cost us".
 */
const props = defineProps<{ kind: "tractor" | "trailer"; unitId: string; enabled: boolean }>();
const window_ = ref(lastTwelveMonths());
const kind = computed(() => props.kind);
const id = computed(() => props.unitId);
const enabled = computed(() => props.enabled);
const q = useUnitRepairBillsQuery(kind, id, window_, enabled);

function lastTwelveMonths(today = new Date()): { from: string; to: string } {
  return { from: ymd(new Date(today.getFullYear(), today.getMonth() - 12, 1)), to: ymd(new Date(today.getFullYear(), today.getMonth(), 1)) };
}
const pct = (r: number) => `${Math.round(r * 100)}%`;
</script>

<template>
  <p v-if="enabled" class="text-sm text-ink-secondary" data-test="unit-repair-bills">
    <QueryState compact :loading="q.isPending.value && !q.isError.value" :error="q.isError.value" :retrying="q.isFetching.value" loading-text="Adding up the repair bills…" error-text="Could not load the repair bills." @retry="q.refetch()">
      <template v-if="q.data.value?.unavailable">Repair bills for the last 12 months can't be shown yet: {{ q.data.value.unavailable }}</template>
      <template v-else-if="q.data.value">
        <span class="font-medium text-ink">{{ q.data.value.total === null ? "—" : fmtMoney(q.data.value.total) }}</span>
        in repair bills over the last 12 months ({{ q.data.value.repairCount }} repair{{ q.data.value.repairCount === 1 ? "" : "s" }} through FleetPal<template v-if="q.data.value.ratioLowerBound !== null">, at least {{ pct(q.data.value.ratioLowerBound) }} of the ledger's maintenance seen</template>).
        <RouterLink to="/shop/repair-spend" class="font-medium text-link hover:text-link-hover">Repair bills</RouterLink>
      </template>
    </QueryState>
  </p>
</template>
