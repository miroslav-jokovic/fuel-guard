<script setup lang="ts">
import { computed } from "vue";
import { AppCard as BaseCard, QueryState } from "@silvicom/ui";
import { useAssetsQuery } from "./useAssets";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDate } from "@/lib/format";

/**
 * The driver page's *Equipment* card (DE2b; D-DE1, D-DE3): the tablets this driver holds.
 *
 * ── WHO SEES IT ───────────────────────────────────────────────────────────────────────────────
 * The assets route needs `maintenance: view`, and the driver page is gated by `roster` — a recruiter
 * opens the page without the shop's section. So the page mounts this card only for
 * `session.canView("maintenance")`, which reads the section matrix; a card that fetched and showed
 * "could not load" to everybody without the section would be the failure dressed as content.
 *
 * ── WHAT A ROW SAYS ───────────────────────────────────────────────────────────────────────────
 * Its number and name (a link to the asset page, where Return to shop lives), the IMEI's last five
 * digits — what a person reads off the sticker to match the tablet in their hand — and since when,
 * which the API answers for one driver's list alone (`sinceGivenTo`). *Not returned* when the driver
 * has left: the card is most useful on exactly the page of somebody who no longer drives.
 *
 * The list is one page of the API's fifty. A driver holds one tablet, two at most; more than fifty
 * would be a data problem the count beside the heading still states honestly.
 */

const props = defineProps<{ driverId: string }>();

const filter = computed(() => ({ driverId: props.driverId, page: 1 }));
const q = useAssetsQuery(filter);
const rows = computed(() => q.data.value?.assets ?? []);
const total = computed(() => q.data.value?.total ?? 0);
</script>

<template>
  <BaseCard data-test="driver-equipment">
    <div class="flex items-baseline justify-between gap-3">
      <h2 class="text-sm font-semibold text-ink">Equipment</h2>
      <span v-if="total > 0" class="text-xs text-ink-tertiary">{{ total }} held</span>
    </div>
    <QueryState
      compact
      :loading="q.isLoading.value"
      :error="q.isError.value"
      :retrying="q.isFetching.value"
      loading-text="Loading the equipment…"
      error-text="Could not load the equipment."
      @retry="q.refetch()"
    >
      <p v-if="rows.length === 0" class="mt-3 text-sm text-ink-muted">No tablet or other equipment is with this driver.</p>
      <ul v-else class="mt-3 divide-y divide-edge-subtle">
        <li v-for="a in rows" :key="a.id" class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
          <div class="min-w-0">
            <RouterLink :to="{ name: 'asset', params: { id: a.id } }" class="text-sm font-medium text-ink hover:underline">
              <span class="font-mono text-xs text-ink-secondary">{{ a.displayNo }}</span> {{ a.name }}
            </RouterLink>
            <p class="mt-0.5 text-xs text-ink-tertiary">
              {{ a.assetTypeName }}
              <template v-if="a.imei"> · IMEI …{{ a.imei.slice(-5) }}</template>
              <template v-if="a.holder.since"> · since {{ formatDate(a.holder.since) }}</template>
            </p>
          </div>
          <span v-if="a.holder.notReturned" :class="[BADGE_BASE, toneClass('danger')]">Not returned</span>
        </li>
      </ul>
    </QueryState>
  </BaseCard>
</template>
