<script setup lang="ts">
/**
 * A ranked list whose rows are bars (D-FO5). Bar length is the row's open cases against the
 * longest row; the critical share is a status-red segment at the left, so "most open" and "most
 * critical" can be read apart in one glance where two badges per row could not.
 *
 * Replaces `RiskList`, which rendered the same rows as "N open" / "N critical" pills — the
 * figures stay, in text, at the right of every row, so nothing a screen reader or a narrow screen
 * needs lives in the bar alone.
 */
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { AppIcon } from "@silvicom/ui";
import { ShieldCheckIcon } from "@silvicom/ui/icons";
import type { RiskRow } from "@silvicom/shared";
import { useOpens } from "@/composables/useOpens";
import { viz } from "@/lib/chartTheme";

const props = defineProps<{
  rows: readonly RiskRow[];
  /** `/vehicles` or `/drivers`; the row links only when that page opens for the reader (SP5). */
  linkBase: string;
  emptyLabel: string;
}>();

const opens = useOpens();
const linked = computed(() => opens(`${props.linkBase}/_`));
const longest = computed(() => Math.max(1, ...props.rows.map((r) => r.anomalyCount)));
const width = (n: number) => `${Math.round((n / longest.value) * 100)}%`;
</script>

<template>
  <div v-if="rows.length === 0" class="flex flex-col items-center justify-center gap-2 py-10 text-center">
    <AppIcon :icon="ShieldCheckIcon" class="size-8 text-success-500" aria-hidden="true" />
    <p class="text-sm font-medium text-ink">{{ emptyLabel }}</p>
    <p class="text-xs text-ink-muted">No open cases in this period.</p>
  </div>

  <ol v-else class="space-y-1">
    <li v-for="(row, i) in rows" :key="row.id">
      <component
        :is="linked ? RouterLink : 'div'"
        v-bind="linked ? { to: `${linkBase}/${row.id}` } : {}"
        class="group grid grid-cols-[1.25rem_6rem_minmax(0,1fr)_auto] items-center gap-3 rounded-surface px-1 py-1.5"
        :class="linked && 'hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus-ring'"
      >
        <span class="text-xs tabular-nums text-ink-tertiary" aria-hidden="true">{{ i + 1 }}</span>
        <span class="truncate text-sm font-medium" :class="linked ? 'text-ink group-hover:text-link' : 'text-ink'">{{ row.label }}</span>
        <span class="flex h-2 gap-0.5" aria-hidden="true">
          <span v-if="row.criticalCount > 0" class="block h-full rounded-detail" :style="{ width: width(row.criticalCount), backgroundColor: viz.severity.critical }" /> <!-- token-check-disable-line: token-resolved chart color -->
          <span
            v-if="row.anomalyCount - row.criticalCount > 0"
            class="block h-full rounded-detail bg-surface-muted"
            :style="{ width: width(row.anomalyCount - row.criticalCount) }"
          />
        </span>
        <span class="whitespace-nowrap text-xs tabular-nums text-ink-muted">
          <b class="font-semibold text-ink">{{ row.anomalyCount }}</b> open<template v-if="row.criticalCount"> · {{ row.criticalCount }} critical</template>
        </span>
      </component>
    </li>
  </ol>
</template>
