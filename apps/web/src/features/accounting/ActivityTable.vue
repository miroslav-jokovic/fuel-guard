<script setup lang="ts">
import { computed } from "vue";
import { AppCard as BaseCard } from "@silvicom/ui";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import { useBillingActivityQuery, type ActivityGrain, type ActivityPeriodRow } from "./useBillingActivity";

/**
 * Revenue and activity, week by week (W2).
 *
 * **What this tab is, and what it deliberately is not.** It answers what a dispatcher watches
 * between month-end closes: how many loads went, what they earned, and whether the rate per billed
 * mile is moving. It carries **no cost and no cost per mile**, and that is a decision rather than an
 * omission — 26.2% of a month's expense arrives as a handful of month-end journal entries (the
 * lease, the insurance, the payroll), so a weekly cost figure would show three cheap weeks and one
 * enormous one: arithmetically correct and operationally meaningless (D-FLEET10). Spreading them
 * across weeks would be allocation, which this section does not do.
 *
 * **Every rate here is per BILLED mile** — the miles the loads were priced on — never per mile
 * driven. Samsara's IFTA feed is monthly by design, so a weekly driven figure does not exist to
 * divide by. The two are different questions with different divisors, and the column says which
 * one it is (G9).
 */

const props = defineProps<{ from: string; to: string; grain?: ActivityGrain }>();

const filter = computed(() => ({ from: props.from, to: props.to }));
const grain = computed<ActivityGrain>(() => props.grain ?? "week");
const { data, isLoading, isError } = useBillingActivityQuery(filter, grain);

const fmtUsd = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtRate = (n: number | null) =>
  n == null ? "—" : n.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const fmtMiles = (n: number) => Math.round(n).toLocaleString();
/** "2026-07-06" → "Jul 6". The year is in the period above; a table of weeks repeats it 13 times. */
const day = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

interface Row extends ActivityPeriodRow {
  id: string;
  period: string;
  loadsText: string;
  revenueText: string;
  milesText: string;
  rateText: string;
}

/** Newest first: an activity table is read for what just happened. */
const rows = computed<Row[]>(() =>
  [...(data.value?.periods ?? [])].reverse().map((p) => ({
    ...p,
    id: p.from,
    period: p.from === p.to ? day(p.from) : `${day(p.from)} – ${day(p.to)}`,
    loadsText: p.loads.toLocaleString(),
    revenueText: fmtUsd(p.revenue),
    milesText: fmtMiles(p.billedMiles),
    rateText: fmtRate(p.revenuePerBilledMile),
  })),
);

const columns: DataTableColumn[] = [
  { key: "period", label: "Week" },
  { key: "loadsText", label: "Loads", numeric: true },
  { key: "revenueText", label: "Earned", numeric: true },
  { key: "milesText", label: "Miles billed", numeric: true },
  { key: "rateText", label: "Earned / billed mile", numeric: true },
];

const unposted = computed(() => data.value?.unpostedBills ?? 0);
/** Loads counted in the table whose bill carried no distance — the miles column is short by them. */
const withoutDistance = computed(() =>
  (data.value?.periods ?? []).reduce((n, p) => n + p.loadsWithoutDistance, 0),
);
</script>

<template>
  <div class="space-y-4">
    <p v-if="isError" class="text-sm text-danger-600">
      The activity view could not be loaded. Try the period again in a moment.
    </p>

    <template v-else>
      <BaseCard padding="none">
        <div class="border-b border-edge px-4 py-3">
          <h3 class="text-sm font-semibold text-ink">What went, and what it earned</h3>
          <p class="mt-0.5 text-xs text-ink-tertiary">
            Weeks start on Monday. A load counts in the week it DELIVERED, not the week it was
            invoiced — McLeod bills days after the truck arrives.
          </p>
        </div>
        <DataTable
          embedded
          :columns="columns"
          :rows="rows"
          row-key="id"
          :loading="isLoading"
          empty-text="No loads delivered in this period."
        />
      </BaseCard>

      <p class="text-xs text-ink-tertiary">
        There is no cost here, and no cost per mile. Most of a month's cost — the lease, the
        insurance, the payroll — posts as a handful of month-end entries, so splitting it across
        weeks would invent three cheap weeks and one expensive one. The income statement is where
        cost is answered, by the month it actually belongs to.
      </p>
      <p v-if="withoutDistance" class="text-xs text-ink-tertiary">
        {{ withoutDistance }} {{ withoutDistance === 1 ? "load carries" : "loads carry" }} no billed
        distance, so they are counted as loads and their miles are not in the rate.
      </p>
      <p v-if="unposted" class="text-xs text-warning-700">
        {{ unposted }} {{ unposted === 1 ? "bill has" : "bills have" }} not been booked to the ledger
        yet and {{ unposted === 1 ? "is" : "are" }} left out of every figure above.
      </p>
    </template>
  </div>
</template>
