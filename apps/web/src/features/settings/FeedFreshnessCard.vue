<script setup lang="ts">
/**
 * "Is our data fresh?", answered per feed rather than as an adjective (SAM-S5, D-SAM6).
 *
 * The plan's §1.1 is blunt about why this card exists: no mechanism gives "always fresh", so the
 * honest product is a stated bound per feed, monitored and shown. A single global claim would
 * over-poll most feeds and under-serve one — fuel-theft detection tolerates an hour; a live map does
 * not.
 *
 * ── TWO KINDS OF NUMBER, AND THE CARD SAYS WHICH ─────────────────────────────────────────────────
 * A bound marked *Agreed* was ruled by the owner (Q-SAM1) and a breach may page somebody. A bound
 * marked *From cadence* is arithmetic on the poll interval — shown, and deliberately never alerted on,
 * because Q-SAM1's own fallback is that no alert fires on a guessed threshold. Hiding the difference
 * would let a derived number be read as a promise.
 *
 * Its own component rather than a fifth block in `DataSyncPage.vue`: that page was 441 lines against a
 * 500-line budget, and a card is a card.
 */
import { computed, onMounted, ref } from "vue";
import { apiFetch } from "@/lib/api";
import { AppCard as BaseCard } from "@silvicom/ui";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import type { SamsaraFeedHealth } from "@silvicom/shared";

interface FeedFreshness {
  feeds: SamsaraFeedHealth[];
  alerting: SamsaraFeedHealth[];
  error: string | null;
}

const data = ref<FeedFreshness | null>(null);
const error = ref<string | null>(null);
onMounted(async () => {
  const res = await apiFetch<FeedFreshness>("/api/integrations/samsara/feed-freshness");
  if (res.ok) data.value = res.data ?? null;
  else error.value = res.error?.message ?? "Could not read feed freshness";
});

/** The read itself can fail; so can the reads behind it. Both are shown, neither is swallowed. */
const readError = computed(() => error.value ?? data.value?.error ?? null);
const feeds = computed(() => data.value?.feeds ?? []);
const attention = computed(() => feeds.value.filter((f) => f.needsAttention && f.state !== "disabled"));

const STATE_WORDS: Record<SamsaraFeedHealth["state"], string> = {
  fresh: "On time",
  late: "Late",
  failing: "Refused",
  never: "Never arrived",
  disabled: "Switched off",
};
const stateTone = (s: SamsaraFeedHealth["state"]) =>
  s === "fresh" ? "text-success-700"
    : s === "disabled" ? "text-ink-tertiary"
      : s === "late" ? "text-warning-600"
        : "text-danger-700";

const age = (f: SamsaraFeedHealth) => {
  if (f.ageMinutes == null) return "—";
  if (f.ageMinutes < 60) return `${f.ageMinutes} min`;
  const h = Math.floor(f.ageMinutes / 60);
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} d`;
};
const bound = (f: SamsaraFeedHealth) => {
  if (f.targetMinutes == null) return "—";
  return f.targetMinutes < 60 ? `${f.targetMinutes} min`
    : f.targetMinutes < 48 * 60 ? `${Math.round(f.targetMinutes / 60)} h`
      : `${Math.round(f.targetMinutes / 1440)} d`;
};

const columns: DataTableColumn[] = [
  { key: "label", label: "Feed", cellClass: "font-medium text-ink" },
  { key: "state", label: "Status" },
  { key: "ageMinutes", label: "Last arrived", numeric: true },
  { key: "targetMinutes", label: "Held to", numeric: true },
  { key: "targetSource", label: "Bound" },
];
</script>

<template>
  <BaseCard>
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-semibold text-ink">Feed freshness</h3>
      <span
        v-if="data && !readError"
        class="text-2xl font-bold"
        :class="attention.length === 0 ? 'text-success-700' : 'text-warning-600'"
      >
        {{ feeds.length - attention.length }}/{{ feeds.length }}
      </span>
    </div>
    <p class="mt-1 text-sm text-ink-muted">
      Each Samsara feed arrives on its own schedule, so each is held to its own promise. Nothing here
      claims the data is always current — it says how long ago each feed last delivered, and whether
      that is inside the time it is allowed to take.
    </p>

    <p v-if="readError" class="mt-2 text-sm text-danger-600">{{ readError }}</p>
    <template v-else-if="data">
      <p v-if="attention.length === 0" class="mt-2 text-sm text-ink-secondary">
        Every feed that is switched on delivered inside its bound.
      </p>
      <ul v-else class="mt-2 space-y-1">
        <li v-for="f in attention" :key="f.id" class="text-sm" :class="stateTone(f.state)">
          {{ f.lead }}
          <span v-if="!f.alertable && f.targetSource === 'cadence'" class="text-ink-tertiary">
            No alert is sent for this one — its bound is worked out from the poll interval, not agreed.
          </span>
        </li>
      </ul>

      <div v-if="feeds.length" class="mt-4">
        <DataTable :columns="columns" :rows="feeds" row-key="id">
          <template #cell-label="{ row }">
            <span class="text-ink">{{ row.label }}</span>
            <span class="block text-xs text-ink-tertiary">{{ row.what }}</span>
          </template>
          <template #cell-state="{ row }">
            <span class="font-medium" :class="stateTone(row.state)">{{ STATE_WORDS[row.state] }}</span>
          </template>
          <template #cell-ageMinutes="{ row }">{{ age(row) }}</template>
          <template #cell-targetMinutes="{ row }">{{ bound(row) }}</template>
          <template #cell-targetSource="{ row }">
            <span :class="row.targetSource === 'ruling' ? 'text-ink-secondary' : 'text-ink-tertiary'">
              {{ row.targetSource === "ruling" ? "Agreed" : "From cadence" }}
            </span>
          </template>
        </DataTable>
      </div>
      <p class="mt-2 text-xs text-ink-tertiary">
        <strong>Agreed</strong> bounds were set deliberately and a breach raises an alert.
        <strong>From cadence</strong> bounds are worked out from how often the feed is polled; they are
        shown so nothing is unmonitored, and they never raise one.
      </p>
    </template>
  </BaseCard>
</template>
