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
        `Could not identify "${file.name}" as an EFS Transaction or Reject report. Make sure you're exporting a Transaction Detail or Reject/Decline report from EFS (.xlsx or .csv).`,
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
      Fuel lines (diesel/gasoline) are imported; DEF, scales and fees are skipped.
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

      <!-- Duplicate-file warning -->
      <div v-if="preview.alreadyImported" class="flex items-start gap-3 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
        <span class="mt-0.5 shrink-0 text-amber-500">⚠</span>
        <p>
          <strong>This file was already imported.</strong>
          Re-committing is safe — existing rows will be skipped as duplicates — but no new data will be added.
          If you meant to upload a different date range, choose a different file.
        </p>
      </div>

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

      <!-- Faithful preview of the uploaded data (first rows) -->
      <div v-if="preview.kind === 'transaction' && preview.allLines.length" class="space-y-1">
        <p class="text-xs font-medium text-gray-500">Preview (first {{ Math.min(preview.allLines.length, 10) }} of {{ preview.allLines.length }} lines)</p>
        <div class="overflow-x-auto rounded-md ring-1 ring-gray-200">
          <table class="min-w-full divide-y divide-gray-100 text-xs whitespace-nowrap">
            <thead class="bg-gray-50 text-left text-gray-500">
              <tr>
                <th class="px-3 py-2">Tran Date</th><th class="px-3 py-2">Card #</th><th class="px-3 py-2">Unit</th>
                <th class="px-3 py-2">Driver</th><th class="px-3 py-2">Odometer</th><th class="px-3 py-2">Location</th>
                <th class="px-3 py-2">Item</th><th class="px-3 py-2">Qty</th><th class="px-3 py-2">Amt</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <tr v-for="(l, i) in preview.allLines.slice(0, 10)" :key="i">
                <td class="px-3 py-1.5 text-gray-700">{{ l.tran_date }}</td>
                <td class="px-3 py-1.5 text-gray-700">{{ l.card_num }}</td>
                <td class="px-3 py-1.5 font-medium text-gray-900">{{ l.unit }}</td>
                <td class="px-3 py-1.5 text-gray-700">{{ l.driver_name }}</td>
                <td class="px-3 py-1.5 text-gray-700">{{ l.odometer }}</td>
                <td class="px-3 py-1.5 text-gray-700">{{ l.location_name }}</td>
                <td class="px-3 py-1.5 text-gray-700">{{ l.item }}</td>
                <td class="px-3 py-1.5 text-gray-700">{{ l.qty }}</td>
                <td class="px-3 py-1.5 text-gray-700">{{ l.amt }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div v-else-if="preview.kind === 'reject' && preview.newDeclined.length" class="space-y-1">
        <p class="text-xs font-medium text-gray-500">Preview (first {{ Math.min(preview.newDeclined.length, 10) }} of {{ preview.newDeclined.length }})</p>
        <div class="overflow-x-auto rounded-md ring-1 ring-gray-200">
          <table class="min-w-full divide-y divide-gray-100 text-xs whitespace-nowrap">
            <thead class="bg-gray-50 text-left text-gray-500">
              <tr><th class="px-3 py-2">Card #</th><th class="px-3 py-2">Unit</th><th class="px-3 py-2">Driver</th><th class="px-3 py-2">Error</th><th class="px-3 py-2">Description</th></tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <tr v-for="(d, i) in preview.newDeclined.slice(0, 10)" :key="i">
                <td class="px-3 py-1.5 text-gray-700">{{ d.card_ref }}</td>
                <td class="px-3 py-1.5 font-medium text-gray-900">{{ d.unit }}</td>
                <td class="px-3 py-1.5 text-gray-700">{{ d.driver_name }}</td>
                <td class="px-3 py-1.5 text-gray-700">{{ d.error_code }}</td>
                <td class="px-3 py-1.5 text-gray-700">{{ d.error_description }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

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
