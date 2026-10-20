<script setup lang="ts">
/**
 * Driver files — is every driver legal to drive? (FLEET-MANAGER-HOME-PLAN §4 card 3).
 *
 * ── IT COUNTS DRIVERS, NOT ITEMS, BECAUSE ITS DOOR LISTS DRIVERS ─────────────────────────────────
 * The weekly digest's rollup (`buildDqDigestSection`) counts expired ITEMS — a driver with a lapsed
 * medical card and a lapsed MVR review is two. The Drivers page's `?file=expired` lists DRIVERS. A
 * card that showed the digest's 7 over a list of 4 would read as a bug, so the rows here ask the File
 * chip (`matchesFileFilter` over `fileChip`) — the Drivers page's own predicate — and only the "next
 * up" line borrows the digest's ranking, which is a pair (driver + item) by nature (D-FM7). Since Q-UF9
 * the three rows are the chip's words, so they no longer overlap: a driver with something lapsed AND
 * something due soon is counted once, as expired, which is what their File cell says.
 *
 * No header door: every row already opens `/drivers?file=…`, and at four columns of twelve a door
 * beside the title sat on top of it (browser pass, 2026-10-12).
 *
 * The overview is active and on-leave drivers only (`complianceOverview`), which is the population a
 * fleet manager means by "legal to drive"; the door adds no status filter, matching that.
 */
import { computed } from "vue";
import { ClipboardDocumentListIcon } from "@silvicom/ui/icons";
import { buildDqDigestSection, FILE_FILTER_LABELS, fileChip, matchesFileFilter, type FileFilterKind } from "@silvicom/shared";
import ChartCard from "@/components/ui/ChartCard.vue";
import CountList, { type CountRow } from "@/components/ui/CountList.vue";
import { useComplianceOverviewQuery } from "@/composables/useCompliance";

const { data: overview } = useComplianceOverviewQuery();
const drivers = computed(() => overview.value?.drivers ?? null);

const count = (f: FileFilterKind) => (drivers.value ? drivers.value.filter((d) => matchesFileFilter(fileChip(d), f)).length : null);
const row = (f: FileFilterKind, caption: string, alarm = false): CountRow => ({
  key: f,
  label: FILE_FILTER_LABELS[f],
  value: count(f),
  caption,
  to: `/drivers?file=${f}`,
  door: "Drivers",
  alarm,
});

const rows = computed<CountRow[]>(() => [
  row("expired", "drivers with something lapsed", true),
  row("expiring", "drivers with something due soon, nothing lapsed"),
  row("not_started", "drivers whose file is empty"),
]);

const complete = computed(() => count("complete"));
const next = computed(() => {
  const top = drivers.value ? buildDqDigestSection(drivers.value).topPairs[0] : undefined;
  return top ? `${top.driver} — ${top.label}, ${top.due}` : null;
});
</script>

<template>
  <ChartCard
    title="Driver files"
    subtitle="Active and on-leave drivers"
    :icon="ClipboardDocumentListIcon"
    tone="caution"
    :readout="complete == null || !drivers ? '—' : `${complete} of ${drivers.length}`"
    caption="files complete"
    class="h-full"
  >
    <CountList :rows="rows" />
    <!-- Below the counts, not as the subtitle: at three columns of twelve a driver's name and item
         beside the header door wrapped one word to a line (browser pass, 2026-10-12). -->
    <p v-if="next" class="mt-3 border-t border-edge-subtle pt-3 text-xs text-ink-muted" data-test="dq-next">
      <span class="font-medium text-ink">Next:</span> {{ next }}
    </p>
  </ChartCard>
</template>
