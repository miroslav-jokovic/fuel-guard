<script setup lang="ts">
import { computed } from "vue";
import { loadChargeSplitNote, loadRatePerMile, usd2, type LoadCharges } from "@silvicom/shared";

/**
 * A load's price in a table cell — the Loads list's Rate and Per mile, the Dispatch board's Rate
 * (LOAD-RATES-PLAN D-RATE8). One component so the two tables cannot word the same figure two ways.
 *
 * Exact cents (`usd2`, the Finance pages' formatter): a load's price is checked against McLeod's line by
 * line, and a rounded figure would never match. Nothing at all for a load McLeod states no price for —
 * an empty or voided move (D-RATE3) — and "—" per mile when McLeod billed no miles. A split order's leg
 * shows the ORDER's total (D-RATE4), so the Rate says so underneath; the board's cells wrap, not widen.
 *
 * `perMileLine` puts the rate per mile under the Rate on the Loads list (owner, 2026-11-20, Q-RATE1 (b)):
 * one column instead of two keeps the list's default tab inside 1440 px; the Per mile column stays in
 * Columns, hidden, for whoever wants it sortable.
 *
 * Only ever mounted in a column that exists for a `dispatch.load_rates` holder; anyone else's rows carry
 * no `charges`, because the server withholds them (D-RATE7).
 */
const props = defineProps<{ charges: LoadCharges | null | undefined; figure: "rate" | "per_mile"; perMileLine?: boolean }>();

const text = computed(() =>
  props.charges ? usd2(props.figure === "rate" ? props.charges.total_charge : loadRatePerMile(props.charges)) : "",
);
const perMile = computed(() => (props.perMileLine && props.figure === "rate" && props.charges ? `${usd2(loadRatePerMile(props.charges))} / mi` : null));
const note = computed(() => (props.figure === "rate" && props.charges ? loadChargeSplitNote(props.charges) : null));
</script>

<template>
  <span v-if="charges" class="tabular-nums">{{ text }}</span>
  <p v-if="perMile" class="text-xs tabular-nums text-ink-secondary" title="Rate per mile: the order's total over its billed miles">{{ perMile }}</p>
  <!-- Wraps under the figure: the Loads list's cells are `nowrap`, and one line of note widened Rate 96 → 189 px at 1440. -->
  <p v-if="note" class="whitespace-normal text-xs text-ink-muted">{{ note }}</p>
</template>
