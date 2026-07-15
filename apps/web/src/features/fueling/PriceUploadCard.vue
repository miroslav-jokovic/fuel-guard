<script setup lang="ts">
import { ref } from "vue";
import { ArrowUpTrayIcon, CheckCircleIcon } from "@heroicons/vue/24/outline";
import BaseCard from "@/components/ui/BaseCard.vue";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import { useToastStore } from "@/stores/toast";
import { uploadPriceReport, type PriceIngestResult } from "./usePriceUpload";

const toast = useToastStore();
const loading = ref(false);
const result = ref<PriceIngestResult | null>(null);

async function onFiles(files: File[]) {
  const file = files[0];
  if (!file || loading.value) return;
  loading.value = true;
  result.value = null;
  try {
    result.value = await uploadPriceReport(file);
    toast.success("Prices loaded", `${result.value.pricesInserted.toLocaleString()} prices from ${result.value.effectiveDate ?? "the report"}.`);
  } catch (e) {
    toast.error("Could not load prices", e instanceof Error ? e.message : undefined);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <BaseCard>
    <div class="flex items-start justify-between gap-4">
      <div>
        <h3 class="text-sm font-semibold text-ink">Daily fuel prices</h3>
        <p class="mt-1 text-sm text-ink-muted">Upload today's Pilot "Better Of Pricing Report" (.xls) to load net pump prices for the corridor.</p>
      </div>
      <ArrowUpTrayIcon class="size-5 shrink-0 text-ink-subtle" aria-hidden="true" />
    </div>

    <div class="mt-3">
      <FileDropzone accept=".xls,.xlsx" :disabled="loading" @files="onFiles" />
    </div>

    <p v-if="loading" class="mt-3 text-sm text-ink-secondary">Geocoding sites &amp; loading prices… the first load can take a moment.</p>

    <template v-if="result">
      <div class="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-md bg-success-50 px-3 py-2 text-sm text-success-800">
        <span class="inline-flex items-center gap-1.5 font-medium"><CheckCircleIcon class="size-4" aria-hidden="true" /> Loaded {{ result.effectiveDate }}</span>
        <span>{{ result.pricesInserted.toLocaleString() }} prices</span>
        <span>{{ result.stationsUpserted.toLocaleString() }} stations placed</span>
        <span v-if="result.duplicatesInFile" title="Repeated site rows in the file were collapsed (last wins).">{{ result.duplicatesInFile }} duplicate rows merged</span>
        <span v-if="result.geocodeFailed" class="text-caution-700">{{ result.geocodeFailed }} still geocoding</span>
      </div>
      <p v-if="result.geocodeFailed" class="mt-2 text-sm text-ink-secondary">
        {{ result.geocodeFailed.toLocaleString() }} site(s) hit HERE's rate limit this run. Placed sites are cached — <strong>upload the same file again</strong> to finish the rest (it will be quick).
      </p>
    </template>
  </BaseCard>
</template>
