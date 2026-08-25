<script setup lang="ts">
import { AppIcon } from "@fuelguard/ui";
import {
  ArrowUpTrayIcon,
  CheckCircleIcon,
} from "@fuelguard/ui/icons";
import { computed, ref } from "vue";
import { AppCard as BaseCard } from "@fuelguard/ui";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import { useToastStore } from "@/stores/toast";
import { uploadPriceReport, type PriceIngestResult } from "./usePriceUpload";

/**
 * Upload the daily Pilot price report — one file, or a whole backlog of them.
 *
 * ── WHY MANY FILES AT ONCE ───────────────────────────────────────────────────────────────────────
 * Until 0245 each upload DELETED the one before it, so there was never a reason to hand over more than
 * today's file. Now that reports are kept as a price series, months of them are worth loading, and
 * doing that one drag at a time is not a thing anyone will actually finish. Each report carries its own
 * Effective Date, so order does not matter and re-uploading a file already loaded is a no-op.
 *
 * ── WHY SEQUENTIAL, AND WHY ONE FAILURE DOES NOT STOP THE REST ───────────────────────────────────
 * A first upload geocodes every site it has never seen through HERE, which rate-limits bursts; running
 * files in parallel would turn one slow load into several throttled ones. And a backlog will contain
 * the odd file that is the wrong report or a broken export — that must cost the reader ONE line in the
 * results list, not the other fifty-nine uploads.
 */
const toast = useToastStore();
const loading = ref(false);
/** Which file is in flight, so a sixty-file drop shows progress rather than a frozen card. */
const progress = ref<{ done: number; total: number; current: string } | null>(null);

interface FileOutcome {
  name: string;
  ok: boolean;
  result?: PriceIngestResult;
  error?: string;
}
const outcomes = ref<FileOutcome[]>([]);

const succeeded = computed(() => outcomes.value.filter((o) => o.ok));
const failed = computed(() => outcomes.value.filter((o) => !o.ok));
const totalPrices = computed(() => succeeded.value.reduce((a, o) => a + (o.result?.pricesInserted ?? 0), 0));
const totalStations = computed(() => succeeded.value.reduce((a, o) => a + (o.result?.stationsUpserted ?? 0), 0));
const stillGeocoding = computed(() => succeeded.value.reduce((a, o) => a + (o.result?.geocodeFailed ?? 0), 0));
/** The span the loaded reports cover — the point of keeping them. */
const dateRange = computed(() => {
  const dates = succeeded.value.map((o) => o.result?.effectiveDate).filter((d): d is string => !!d).sort();
  if (dates.length === 0) return null;
  return dates.length === 1 ? dates[0]! : `${dates[0]} → ${dates[dates.length - 1]}`;
});

async function onFiles(files: File[]) {
  if (files.length === 0 || loading.value) return;
  loading.value = true;
  outcomes.value = [];
  // Oldest first by filename, so a partial run leaves a contiguous series rather than a series with
  // holes in it. Reports are keyed by their own Effective Date, so this is presentation, not correctness.
  const ordered = [...files].sort((a, b) => a.name.localeCompare(b.name));
  try {
    for (const [i, file] of ordered.entries()) {
      progress.value = { done: i, total: ordered.length, current: file.name };
      try {
        outcomes.value = [...outcomes.value, { name: file.name, ok: true, result: await uploadPriceReport(file) }];
      } catch (e) {
        outcomes.value = [...outcomes.value, { name: file.name, ok: false, error: e instanceof Error ? e.message : "Upload failed" }];
      }
    }
    const n = succeeded.value.length;
    if (failed.value.length === 0) {
      toast.success(
        n === 1 ? "Prices loaded" : `${n} reports loaded`,
        `${totalPrices.value.toLocaleString()} prices${dateRange.value ? ` · ${dateRange.value}` : ""}`,
      );
    } else if (n > 0) {
      toast.warning(`${n} of ${ordered.length} reports loaded`, `${failed.value.length} could not be read — see the list below.`);
    } else {
      toast.error("No reports could be loaded", failed.value[0]?.error);
    }
  } finally {
    loading.value = false;
    progress.value = null;
  }
}
</script>

<template>
  <BaseCard>
    <div class="flex items-start justify-between gap-4">
      <div>
        <h3 class="text-sm font-semibold text-ink">Daily fuel prices</h3>
        <p class="mt-1 text-sm text-ink-muted">
          Upload the Pilot "Better Of Pricing Report" — any format it arrives in, including the legacy
          Excel 97-2003 <code class="font-mono text-xs">.xls</code> Pilot actually sends. Drop as many as you like:
          each report is kept under its own effective date, so a backlog goes in at once and re-uploading one
          changes nothing.
        </p>
      </div>
      <AppIcon :icon="ArrowUpTrayIcon" class="size-5 shrink-0 text-ink-tertiary" aria-hidden="true" />
    </div>

    <div class="mt-3">
      <FileDropzone accept=".xls,.xlsx,.xlsm,.csv,.htm,.html" multiple :disabled="loading" @files="onFiles" />
    </div>

    <p v-if="progress" class="mt-3 text-sm text-ink-secondary">
      Loading {{ progress.done + 1 }} of {{ progress.total }} — {{ progress.current }}…
      <span class="text-ink-tertiary">the first load geocodes new sites and can take a moment.</span>
    </p>

    <template v-if="outcomes.length && !loading">
      <div
        v-if="succeeded.length"
        class="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-control bg-success-50 px-3 py-2 text-sm text-success-800"
      >
        <span class="inline-flex items-center gap-1.5 font-medium">
          <AppIcon :icon="CheckCircleIcon" class="size-4" aria-hidden="true" />
          Loaded {{ dateRange ?? `${succeeded.length} report(s)` }}
        </span>
        <span>{{ totalPrices.toLocaleString() }} prices</span>
        <span>{{ totalStations.toLocaleString() }} stations placed</span>
        <span v-if="succeeded.length > 1">{{ succeeded.length }} reports</span>
        <span v-if="stillGeocoding" class="text-caution-700">{{ stillGeocoding }} still geocoding</span>
      </div>

      <p v-if="stillGeocoding" class="mt-2 text-sm text-ink-secondary">
        {{ stillGeocoding.toLocaleString() }} site(s) hit HERE's rate limit. Placed sites are cached —
        <strong>drop the same files again</strong> to finish the rest, which will be quick.
      </p>

      <div v-if="failed.length" class="mt-3 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700 ring-1 ring-danger-100">
        <p class="font-medium">{{ failed.length }} file(s) could not be read</p>
        <ul class="mt-1 space-y-0.5">
          <li v-for="f in failed" :key="f.name" class="text-xs">
            <span class="font-mono">{{ f.name }}</span> — {{ f.error }}
          </li>
        </ul>
      </div>
    </template>
  </BaseCard>
</template>
