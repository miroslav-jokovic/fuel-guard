<script setup lang="ts">
import { computed } from "vue";
import { loadChargeSplitNote, loadRatePerMile, usd2, type LoadCharges } from "@silvicom/shared";
import { AppCard, FactList, type Fact } from "@silvicom/ui";
import { useSessionStore } from "@/stores/session";

/**
 * A load's "Rate" block — total, linehaul, other charges and rate per mile, and the split note when the
 * order is carried in more than one trip (LOAD-RATES-PLAN D-RATE8). One component for the load's page
 * (`card`) and the Dispatch board's truck drawer, so the two cannot word the same price two ways.
 *
 * Drawn only for a reader holding `dispatch.load_rates` AND whose response carried the `charges` key: the
 * server withholds the key from anyone else (D-RATE7), and a holder whose response lacks it — an API that
 * failed closed — must see nothing rather than a claim that McLeod states no price. `charges: null` is
 * that claim, made by the server for an empty or voided move (D-RATE3), and is said in words.
 *
 * Exact cents (`usd2`, the Finance pages' formatter): the figure is checked against McLeod's line by line.
 */
const props = defineProps<{ charges: LoadCharges | null | undefined; card?: boolean }>();
const session = useSessionStore();

const shown = computed(() => props.charges !== undefined && session.hasPermission("dispatch.load_rates"));
const money = (n: number | null): string | null => (n == null ? null : usd2(n));
const facts = computed<Fact[]>(() => {
  const c = props.charges;
  if (!c) return [];
  return [
    { label: "Total", value: usd2(c.total_charge), numeric: true },
    { label: "Linehaul", value: money(c.linehaul), numeric: true },
    { label: "Other charges", value: money(c.other_charges), numeric: true },
    // No billed miles (D-RATE5): FactList draws its em dash.
    { label: "Per mile", value: money(loadRatePerMile(c)), numeric: true },
  ];
});
const splitNote = computed(() => (props.charges ? loadChargeSplitNote(props.charges) : null));
// Every order measured was in US dollars (13,478 / 13,478 since 01-01); a figure that is not must say so
// rather than wear a dollar sign it has not earned.
const foreign = computed(() => {
  const cur = props.charges?.currency;
  return cur && cur !== "USD" ? cur : null;
});
</script>

<template>
  <component :is="card ? AppCard : 'section'" v-if="shown" aria-labelledby="load-rate-heading" class="space-y-2" data-testid="load-rate">
    <component :is="card ? 'h2' : 'h3'" id="load-rate-heading" class="text-sm font-semibold text-ink">Rate</component>
    <template v-if="charges">
      <FactList :facts="facts" />
      <p v-if="splitNote" class="text-xs text-ink-muted" data-testid="load-rate-split">{{ splitNote }}</p>
      <p v-if="foreign" class="text-xs text-caution-700">McLeod states this order in {{ foreign }}.</p>
    </template>
    <p v-else class="text-sm text-ink-muted">McLeod states no rate for this load.</p>
  </component>
</template>
