<script setup lang="ts">
import { computed } from "vue";
import { AppBadge } from "@silvicom/ui";
import { inspectionExpiry } from "@silvicom/shared";

/**
 * A unit's annual-inspection standing, as the roster shows it (D-AVI16).
 *
 * One component for both the vehicles page and the trailers page, so "expiring" cannot come to mean
 * two different things on two screens — which is the whole reason the threshold and the calculation
 * live in `@silvicom/shared` rather than in either page.
 *
 * The date is projected onto the equipment row when an inspection is completed, so this column reads
 * a plain column and needs no extra query.
 */

const props = defineProps<{ expiresOn?: string | null; today?: string }>();

const status = computed(() =>
  inspectionExpiry(props.expiresOn ?? null, props.today ?? new Date().toISOString().slice(0, 10)),
);

const tone = computed(() =>
  status.value.state === "expired" ? "danger" : status.value.state === "expiring" ? "caution" : "neutral",
);

/** Plain words. "Due in 12 days" is what somebody walking the yard needs; a date alone is not. */
const label = computed(() => {
  const s = status.value;
  if (s.state === "unknown") return "Not recorded";
  if (s.state === "expired") {
    const d = Math.abs(s.daysRemaining ?? 0);
    return d === 0 ? "Due today" : `Overdue by ${d} day${d === 1 ? "" : "s"}`;
  }
  if (s.state === "expiring") {
    const d = s.daysRemaining ?? 0;
    return d === 0 ? "Due today" : `Due in ${d} day${d === 1 ? "" : "s"}`;
  }
  return s.expiresOn ?? "—";
});
</script>

<template>
  <span class="inline-flex items-center gap-2">
    <AppBadge v-if="status.state !== 'valid'" :tone="tone">{{ label }}</AppBadge>
    <span v-else class="text-ink-secondary">{{ label }}</span>
    <span v-if="status.state === 'expiring' || status.state === 'expired'" class="text-xs text-ink-tertiary">
      {{ status.expiresOn }}
    </span>
  </span>
</template>
