<script setup lang="ts">
import { ref } from "vue";
import { ArrowUpTrayIcon } from "@heroicons/vue/24/outline";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import { useDriversQuery } from "@/features/fleet/useDrivers";
import { analyzeImport, useCommitImport, type ImportPreview } from "@/features/import/useImport";
import { useToastStore } from "@/stores/toast";

const { data: vehicles } = useVehiclesQuery();
const { data: drivers } = useDriversQuery();
const commit = useCommitImport();

const toast = useToastStore();
const analyzing = ref(false);
const preview = ref<ImportPreview | null>(null);

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  preview.value = null;
  analyzing.value = true;
  try {
    const p = await analyzeImport(file, vehicles.value ?? [], drivers.value ?? []);
    if (p.kind === "unknown") {
      toast.warning(
        "Unrecognized file",
        "Could not identify this file as an EFS Transaction or Reject report.",
      );
    } else {
      preview.value = p;
    }
  } catch (err) {
    toast.error("Could not read file", err instanceof Error ? err.message : undefined);
  } finally {
    analyzing.value = false;
    input.value = "";
  }
}

async function onCommit() {
  if (!preview.value) return;
  try {
    await commit.mutateAsync(preview.value);
    toast.success("Import complete", "Transactions have been saved.");
    preview.value = null;
  } catch (err) {
    toast.error("Import failed", err instanceof Error ? err.message : undefined);
  }
}

const reset = () => {
  preview.value = null;
};
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-6">
    <p class="text-sm text-gray-500">
      Upload an EFS <strong>Transaction</strong> or <strong>Reject</strong> report (.xlsx or .csv).
      We import only fuel lines (diesel/gasoline); DEF, scales and fees are skipped. Re-uploading the
      same file is safe — duplicates are detected automatically.
    </p>

    <!-- Upload -->
    <div
      v-if="!preview"
      class="rounded-lg border-2 border-dashed border-gray-300 bg-white px-6 py-12 text-center"
    >
      <ArrowUpTrayIcon class="mx-auto size-10 text-gray-400" aria-hidden="true" />
      <label class="mt-4 inline-block cursor-pointer">
        <span
          class="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
          >{{ analyzing ? "Reading…" : "Choose EFS file" }}</span
        >
        <input type="file" accept=".xlsx,.xls,.csv" class="sr-only" :disabled="analyzing" @change="onFile" />
      </label>
      <p class="mt-2 text-xs text-gray-400">.xlsx or .csv</p>
    </div>

    <!-- Review -->
    <div v-if="preview" class="space-y-5 rounded-lg bg-white p-6 shadow-sm ring-1 ring-gray-200">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-base font-semibold text-gray-900">Review import</h3>
          <p class="text-sm text-gray-500">
            {{ preview.filename }} · {{ preview.kind === "reject" ? "Reject report" : "Transaction report" }}
            ({{ preview.source.toUpperCase() }}) · {{ preview.totalRows }} rows
          </p>
        </div>
      </div>

      <dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <template v-if="preview.kind === 'transaction'">
          <div class="rounded-md bg-gray-50 p-3">
            <dt class="text-xs text-gray-500">New fill-ups</dt>
            <dd class="text-2xl font-semibold text-gray-900">{{ preview.newFuel.length }}</dd>
          </div>
          <div class="rounded-md bg-gray-50 p-3">
            <dt class="text-xs text-gray-500">Duplicates</dt>
            <dd class="text-2xl font-semibold text-gray-500">{{ preview.duplicateFuelCount }}</dd>
          </div>
          <div class="rounded-md bg-amber-50 p-3">
            <dt class="text-xs text-amber-700">Unattributed</dt>
            <dd class="text-2xl font-semibold text-amber-800">{{ preview.unattributedCount }}</dd>
          </div>
          <div class="rounded-md bg-gray-50 p-3">
            <dt class="text-xs text-gray-500">Non-fuel skipped</dt>
            <dd class="text-2xl font-semibold text-gray-500">{{ preview.skippedCount }}</dd>
          </div>
        </template>
        <template v-else>
          <div class="rounded-md bg-gray-50 p-3">
            <dt class="text-xs text-gray-500">New declined</dt>
            <dd class="text-2xl font-semibold text-gray-900">{{ preview.newDeclined.length }}</dd>
          </div>
          <div class="rounded-md bg-gray-50 p-3">
            <dt class="text-xs text-gray-500">Duplicates</dt>
            <dd class="text-2xl font-semibold text-gray-500">{{ preview.duplicateDeclinedCount }}</dd>
          </div>
        </template>
      </dl>

      <p v-if="preview.kind === 'transaction' && preview.unattributedCount > 0" class="text-xs text-amber-700">
        {{ preview.unattributedCount }} fill-up(s) couldn't be matched to a vehicle by Unit number —
        they'll import as unattributed. Check that vehicle unit numbers match EFS.
      </p>

      <div class="flex justify-end gap-3">
        <button
          class="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-700 ring-1 ring-gray-300 ring-inset hover:bg-gray-50"
          @click="reset"
        >
          Cancel
        </button>
        <button
          :disabled="commit.isPending.value"
          class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
          @click="onCommit"
        >
          {{ commit.isPending.value ? "Importing…" : "Commit import" }}
        </button>
      </div>
    </div>
  </div>
</template>
