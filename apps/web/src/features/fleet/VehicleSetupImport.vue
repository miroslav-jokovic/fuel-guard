<script setup lang="ts">
import { ref } from "vue";
import type { Vehicle } from "@fuelguard/shared";
import { analyzeSetupImport, useCommitVehicleSetup, type SetupImportPreview } from "./useVehicleSetupImport";
import { useToastStore } from "@/stores/toast";

const props = defineProps<{ vehicles: Vehicle[] }>();
const emit = defineEmits<{ done: [] }>();

const toast = useToastStore();
const commit = useCommitVehicleSetup();
const preview = ref<SetupImportPreview | null>(null);
const reading = ref(false);

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  reading.value = true;
  try {
    const text = await file.text();
    preview.value = analyzeSetupImport(text, file.name, props.vehicles);
  } catch (err) {
    toast.error("Could not read file", err instanceof Error ? err.message : undefined);
  } finally {
    reading.value = false;
    input.value = "";
  }
}

async function onCommit() {
  if (!preview.value) return;
  try {
    const n = await commit.mutateAsync(preview.value);
    toast.success(`Updated ${n} vehicle${n === 1 ? "" : "s"}`, "Run 'Rebuild' on the Anomalies page so tank checks use the new values.");
    preview.value = null;
    emit("done");
  } catch (err) {
    toast.error("Import failed", err instanceof Error ? err.message : undefined);
  }
}

const fmt = (n: number | null) => (n == null ? "—" : String(n));
</script>

<template>
  <div class="space-y-5">
    <p class="text-sm text-gray-500">
      Upload the edited setup CSV. Vehicles are matched by <strong>unit number</strong>; only tank capacity and
      baseline MPG are updated. Blank cells are left unchanged, so a partially-filled sheet is safe.
    </p>

    <div v-if="!preview" class="rounded-lg border-2 border-dashed border-gray-300 bg-white px-6 py-10 text-center">
      <label class="inline-block cursor-pointer">
        <span class="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
          {{ reading ? "Reading…" : "Choose setup CSV" }}
        </span>
        <input type="file" accept=".csv" class="sr-only" :disabled="reading" @change="onFile" />
      </label>
      <p class="mt-2 text-xs text-gray-400">Download the template first with “Export setup”.</p>
    </div>

    <div v-else class="space-y-4">
      <dl class="grid grid-cols-3 gap-3">
        <div class="rounded-md bg-gray-50 p-3">
          <dt class="text-xs text-gray-500">Will change</dt>
          <dd class="text-2xl font-semibold text-gray-900">{{ preview.changes.length }}</dd>
        </div>
        <div class="rounded-md bg-gray-50 p-3">
          <dt class="text-xs text-gray-500">Unchanged</dt>
          <dd class="text-2xl font-semibold text-gray-500">{{ preview.unchanged }}</dd>
        </div>
        <div class="rounded-md p-3" :class="preview.unmatchedUnits.length ? 'bg-amber-50' : 'bg-gray-50'">
          <dt class="text-xs" :class="preview.unmatchedUnits.length ? 'text-amber-700' : 'text-gray-500'">Unmatched units</dt>
          <dd class="text-2xl font-semibold" :class="preview.unmatchedUnits.length ? 'text-amber-800' : 'text-gray-500'">{{ preview.unmatchedUnits.length }}</dd>
        </div>
      </dl>

      <div v-if="preview.unmatchedUnits.length" class="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
        No vehicle matches: {{ preview.unmatchedUnits.slice(0, 20).join(", ") }}{{ preview.unmatchedUnits.length > 20 ? "…" : "" }}. Check the unit numbers.
      </div>
      <div v-if="preview.errors.length" class="max-h-32 overflow-y-auto rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200">
        <p v-for="(err, i) in preview.errors" :key="i">{{ err }}</p>
      </div>

      <div v-if="preview.changes.length" class="overflow-hidden rounded-md ring-1 ring-gray-200">
        <table class="min-w-full divide-y divide-gray-100 text-sm">
          <thead class="bg-gray-50 text-left text-xs text-gray-500">
            <tr><th class="px-3 py-2">Unit</th><th class="px-3 py-2">Tank (gal)</th><th class="px-3 py-2">Baseline MPG</th></tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="c in preview.changes.slice(0, 50)" :key="c.id">
              <td class="px-3 py-1.5 font-medium text-gray-900">{{ c.unit_number }}</td>
              <td class="px-3 py-1.5 text-gray-700">
                <span :class="{ 'text-gray-400 line-through': c.tank_before !== c.tank_after }">{{ fmt(c.tank_before) }}</span>
                <span v-if="c.tank_before !== c.tank_after" class="text-gray-900"> → {{ fmt(c.tank_after) }}</span>
              </td>
              <td class="px-3 py-1.5 text-gray-700">
                <span :class="{ 'text-gray-400 line-through': c.mpg_before !== c.mpg_after }">{{ fmt(c.mpg_before) }}</span>
                <span v-if="c.mpg_before !== c.mpg_after" class="text-gray-900"> → {{ fmt(c.mpg_after) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="preview.changes.length > 50" class="px-3 py-2 text-xs text-gray-400">+{{ preview.changes.length - 50 }} more…</p>
      </div>

      <div class="flex justify-end gap-3">
        <button class="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-700 ring-1 ring-gray-300 ring-inset hover:bg-gray-50" @click="preview = null">
          Choose another
        </button>
        <button
          :disabled="commit.isPending.value || !preview.changes.length"
          class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
          @click="onCommit"
        >
          {{ commit.isPending.value ? "Saving…" : `Apply ${preview.changes.length} change${preview.changes.length === 1 ? "" : "s"}` }}
        </button>
      </div>
    </div>
  </div>
</template>
