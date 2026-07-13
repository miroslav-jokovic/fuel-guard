<script setup lang="ts">
import { ref, computed } from "vue";
import { ArrowDownTrayIcon } from "@heroicons/vue/20/solid";
import type { Vehicle } from "@fuelguard/shared";
import {
  buildVehicleImportTemplate,
  buildSetupCsv,
  analyzeVehicleImportFile,
  useCommitVehicleImport,
  type VehicleImportPreview,
} from "./useVehicleSetupImport";
import { useToastStore } from "@/stores/toast";
import BaseButton from "@/components/ui/BaseButton.vue";

const props = defineProps<{ vehicles: Vehicle[] }>();
const emit = defineEmits<{ done: [] }>();

const toast   = useToastStore();
const commit  = useCommitVehicleImport();
const preview = ref<VehicleImportPreview | null>(null);
const reading = ref(false);

// ── template downloads ────────────────────────────────────────────────────────
function download(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

const downloadTemplate    = () => download(buildVehicleImportTemplate(), "vehicles-import-template.csv");
const downloadCurrentFleet = () => download(buildSetupCsv(props.vehicles), `fleet-setup-${new Date().toISOString().slice(0, 10)}.csv`);

// ── file upload ───────────────────────────────────────────────────────────────
async function onFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file  = input.files?.[0];
  if (!file) return;
  reading.value = true;
  try {
    preview.value = await analyzeVehicleImportFile(file, props.vehicles);
  } catch (err) {
    toast.error("Could not read file", err instanceof Error ? err.message : undefined);
  } finally {
    reading.value = false;
    input.value   = "";
  }
}

// ── commit ────────────────────────────────────────────────────────────────────
async function onCommit() {
  if (!preview.value) return;
  try {
    const { created, updated } = await commit.mutateAsync(preview.value);
    const parts: string[] = [];
    if (created) parts.push(`${created} vehicle${created === 1 ? "" : "s"} created`);
    if (updated) parts.push(`${updated} vehicle${updated === 1 ? "" : "s"} updated`);
    toast.success("Import complete", parts.join(", ") + ". Detection picks up new values on the next scoring run.");
    preview.value = null;
    emit("done");
  } catch (err) {
    toast.error("Import failed", err instanceof Error ? err.message : undefined);
  }
}

const actionCount = computed(() => (preview.value?.toCreate.length ?? 0) + (preview.value?.toUpdate.length ?? 0));
const fmt         = (n: number | null) => (n == null ? "—" : String(n));
const equipLabel  = (apu: string | null, opt: boolean | null) => {
  const parts: string[] = [];
  if (apu && apu !== "none") parts.push(apu);
  if (opt) parts.push("Optimized idle");
  if (parts.length) return parts.join(" + ");
  return apu === "none" ? "None" : "—";
};
</script>

<template>
  <div class="space-y-5">

    <!-- ── UPLOAD STATE ── -->
    <template v-if="!preview">

      <!-- How-to steps -->
      <ol class="space-y-1 rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-800 ring-1 ring-brand-100 list-decimal list-inside">
        <li>Download the blank template below and open it in Excel / Google Sheets</li>
        <li>Delete the two example rows and enter your vehicle data</li>
        <li>Save as CSV or Excel and upload it here</li>
        <li>Review the preview and confirm the import</li>
      </ol>

      <!-- Download buttons -->
      <div class="grid grid-cols-2 gap-3">
        <button
          class="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-brand-300 px-4 py-5 text-center transition-colors hover:border-brand-400 hover:bg-brand-50"
          @click="downloadTemplate"
        >
          <ArrowDownTrayIcon class="size-6 text-brand-500" aria-hidden="true" />
          <span class="text-sm font-semibold text-brand-700">Blank template</span>
          <span class="text-xs text-ink-muted">All fields · 2 example rows</span>
        </button>
        <button
          class="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-edge-strong px-4 py-5 text-center transition-colors hover:border-neutral-400 hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!vehicles.length"
          :title="vehicles.length ? 'Export current fleet — fill in tank / MPG and re-import' : 'No vehicles yet'"
          @click="downloadCurrentFleet"
        >
          <ArrowDownTrayIcon class="size-6 text-ink-subtle" aria-hidden="true" />
          <span class="text-sm font-semibold text-ink-secondary">Current fleet</span>
          <span class="text-xs text-ink-muted">Edit tank / MPG / idle equipment</span>
        </button>
      </div>

      <!-- Field reference -->
      <details class="rounded-lg bg-surface-subtle ring-1 ring-edge">
        <summary class="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-ink-secondary">
          CSV field reference ▾
        </summary>
        <div class="overflow-x-auto border-t border-edge px-4 pb-3 pt-2">
          <table class="min-w-full text-xs">
            <thead>
              <tr class="border-b border-edge text-left text-ink-muted">
                <th class="pb-1.5 pr-4 font-medium">Column</th>
                <th class="pb-1.5 pr-4 font-medium">Required</th>
                <th class="pb-1.5 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-edge-subtle text-ink-secondary">
              <tr><td class="py-1.5 pr-4 font-mono">unit_number</td><td class="pr-4 text-danger-600 font-medium">Yes</td><td>Unique truck ID (e.g. T-101). Used to match existing vehicles.</td></tr>
              <tr><td class="py-1.5 pr-4 font-mono">fuel_type</td><td class="pr-4 text-danger-600 font-medium">New only</td><td>diesel / gasoline / def / electric / other</td></tr>
              <tr><td class="py-1.5 pr-4 font-mono">make</td><td class="pr-4 text-ink-subtle">No</td><td>e.g. Freightliner, Ford, Kenworth</td></tr>
              <tr><td class="py-1.5 pr-4 font-mono">model</td><td class="pr-4 text-ink-subtle">No</td><td>e.g. Cascadia, F-450, T680</td></tr>
              <tr><td class="py-1.5 pr-4 font-mono">year</td><td class="pr-4 text-ink-subtle">No</td><td>4-digit model year (e.g. 2021)</td></tr>
              <tr><td class="py-1.5 pr-4 font-mono">plate</td><td class="pr-4 text-ink-subtle">No</td><td>License plate number</td></tr>
              <tr><td class="py-1.5 pr-4 font-mono">vin</td><td class="pr-4 text-ink-subtle">No</td><td>17-character VIN</td></tr>
              <tr><td class="py-1.5 pr-4 font-mono">tank_capacity_gal</td><td class="pr-4 text-warning-600 font-medium">Recommended</td><td>Full tank size in gallons. Required for theft detection.</td></tr>
              <tr><td class="py-1.5 pr-4 font-mono">baseline_mpg</td><td class="pr-4 text-warning-600 font-medium">Recommended</td><td>Average MPG. Required for consumption anomaly rules.</td></tr>
              <tr><td class="py-1.5 pr-4 font-mono">current_odometer</td><td class="pr-4 text-ink-subtle">No</td><td>Current odometer reading in miles</td></tr>
              <tr><td class="py-1.5 pr-4 font-mono">status</td><td class="pr-4 text-ink-subtle">No</td><td>active / maintenance / retired (default: active)</td></tr>
              <tr><td class="py-1.5 pr-4 font-mono">apu_type</td><td class="pr-4 text-ink-subtle">No</td><td>diesel_apu / battery_hvac / fuel_heater / shore_power / none — idle-reduction equipment</td></tr>
              <tr><td class="py-1.5 pr-4 font-mono">has_optimized_idle</td><td class="pr-4 text-ink-subtle">No</td><td>yes / no — OEM optimized idle (e.g. Freightliner Cascadia)</td></tr>
            </tbody>
          </table>
          <p class="mt-2 text-xs text-ink-muted">
            Existing vehicles are matched by <strong>unit_number</strong> — <em>tank_capacity_gal</em>, <em>baseline_mpg</em>, and idle equipment (<em>apu_type</em>, <em>has_optimized_idle</em>) are updated.
            Unrecognised units create new vehicles.
          </p>
        </div>
      </details>

      <!-- File upload zone -->
      <div class="rounded-lg border-2 border-dashed border-edge-strong bg-surface px-6 py-10 text-center">
        <label class="inline-block cursor-pointer">
          <span class="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-ink-inverse shadow-sm hover:bg-brand-500">
            {{ reading ? "Reading…" : "Choose CSV or Excel file" }}
          </span>
          <input type="file" accept=".csv,.xlsx,.xls" class="sr-only" :disabled="reading" @change="onFile" />
        </label>
        <p class="mt-2 text-xs text-ink-subtle">Upload the completed template to see a preview before importing</p>
      </div>

    </template>

    <!-- ── PREVIEW STATE ── -->
    <template v-else>

      <!-- Filename -->
      <p class="truncate text-xs text-ink-muted">
        File: <strong class="text-ink-secondary">{{ preview.filename }}</strong>
        <span class="ml-2 text-ink-subtle">{{ preview.totalRows }} data row{{ preview.totalRows === 1 ? "" : "s" }}</span>
      </p>

      <!-- Summary stats -->
      <dl class="grid grid-cols-3 gap-3">
        <div class="rounded-lg p-3 ring-1" :class="preview.toCreate.length ? 'bg-success-50 ring-success-200' : 'bg-surface-subtle ring-edge'">
          <dt class="text-xs" :class="preview.toCreate.length ? 'text-success-700' : 'text-ink-muted'">New vehicles</dt>
          <dd class="text-2xl font-bold" :class="preview.toCreate.length ? 'text-success-800' : 'text-ink-subtle'">{{ preview.toCreate.length }}</dd>
        </div>
        <div class="rounded-lg p-3 ring-1" :class="preview.toUpdate.length ? 'bg-brand-50 ring-brand-200' : 'bg-surface-subtle ring-edge'">
          <dt class="text-xs" :class="preview.toUpdate.length ? 'text-brand-700' : 'text-ink-muted'">Setup updates</dt>
          <dd class="text-2xl font-bold" :class="preview.toUpdate.length ? 'text-brand-800' : 'text-ink-subtle'">{{ preview.toUpdate.length }}</dd>
        </div>
        <div class="rounded-lg p-3 ring-1" :class="preview.errors.length ? 'bg-danger-50 ring-danger-200' : 'bg-surface-subtle ring-edge'">
          <dt class="text-xs" :class="preview.errors.length ? 'text-danger-700' : 'text-ink-muted'">Errors</dt>
          <dd class="text-2xl font-bold" :class="preview.errors.length ? 'text-danger-800' : 'text-ink-subtle'">{{ preview.errors.length }}</dd>
        </div>
      </dl>

      <!-- Errors -->
      <div v-if="preview.errors.length" class="max-h-28 overflow-y-auto rounded-lg bg-danger-50 px-3 py-2 text-xs text-danger-700 ring-1 ring-danger-200">
        <p v-for="(err, i) in preview.errors" :key="i">{{ err }}</p>
      </div>

      <!-- New vehicles table -->
      <div v-if="preview.toCreate.length" class="overflow-hidden rounded-lg ring-1 ring-edge">
        <div class="bg-success-50 px-3 py-2 text-xs font-semibold text-success-800 border-b border-success-100">
          New vehicles ({{ preview.toCreate.length }})
        </div>
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-edge-subtle text-sm">
            <thead class="bg-surface-subtle text-left text-xs text-ink-muted">
              <tr>
                <th class="px-3 py-2 font-medium">Unit</th>
                <th class="px-3 py-2 font-medium">Fuel type</th>
                <th class="px-3 py-2 font-medium">Make / Model / Year</th>
                <th class="px-3 py-2 font-medium">Plate / VIN</th>
                <th class="px-3 py-2 font-medium text-right">Tank (gal)</th>
                <th class="px-3 py-2 font-medium text-right">MPG</th>
                <th class="px-3 py-2 font-medium text-right">Odometer</th>
                <th class="px-3 py-2 font-medium">Status</th>
                <th class="px-3 py-2 font-medium">Idle equipment</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-edge-subtle">
              <tr v-for="r in preview.toCreate.slice(0, 50)" :key="r.unit_number" class="hover:bg-surface-subtle">
                <td class="px-3 py-1.5 font-semibold text-ink">{{ r.unit_number }}</td>
                <td class="px-3 py-1.5 capitalize text-ink-secondary">{{ r.fuel_type }}</td>
                <td class="px-3 py-1.5 text-ink-secondary">{{ [r.make, r.model, r.year].filter(Boolean).join(" ") || "—" }}</td>
                <td class="px-3 py-1.5 text-ink-muted text-xs">
                  <div v-if="r.plate">{{ r.plate }}</div>
                  <div v-if="r.vin" class="font-mono">{{ r.vin }}</div>
                  <span v-if="!r.plate && !r.vin">—</span>
                </td>
                <td class="px-3 py-1.5 text-right text-ink-secondary">{{ r.tank_capacity_gal || "—" }}</td>
                <td class="px-3 py-1.5 text-right text-ink-secondary">{{ fmt(r.baseline_mpg) }}</td>
                <td class="px-3 py-1.5 text-right text-ink-secondary">{{ r.current_odometer ? r.current_odometer.toLocaleString() : "—" }}</td>
                <td class="px-3 py-1.5 capitalize text-ink-secondary">{{ r.status }}</td>
                <td class="px-3 py-1.5 text-ink-secondary">{{ equipLabel(r.apu_type, r.has_optimized_idle) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="preview.toCreate.length > 50" class="px-3 py-2 text-xs text-ink-subtle">+{{ preview.toCreate.length - 50 }} more…</p>
        </div>
      </div>

      <!-- Setup updates table -->
      <div v-if="preview.toUpdate.length" class="overflow-hidden rounded-lg ring-1 ring-edge">
        <div class="bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-800 border-b border-brand-100">
          Setup updates ({{ preview.toUpdate.length }}) — existing vehicles, tank &amp; MPG only
        </div>
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-edge-subtle text-sm">
            <thead class="bg-surface-subtle text-left text-xs text-ink-muted">
              <tr>
                <th class="px-3 py-2 font-medium">Unit</th>
                <th class="px-3 py-2 font-medium">Tank (gal)</th>
                <th class="px-3 py-2 font-medium">Baseline MPG</th>
                <th class="px-3 py-2 font-medium">Idle equipment</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-edge-subtle">
              <tr v-for="c in preview.toUpdate.slice(0, 50)" :key="c.id" class="hover:bg-surface-subtle">
                <td class="px-3 py-1.5 font-medium text-ink">{{ c.unit_number }}</td>
                <td class="px-3 py-1.5 text-ink-secondary">
                  <span :class="c.tank_before !== c.tank_after ? 'text-ink-subtle line-through' : ''">{{ fmt(c.tank_before) }}</span>
                  <span v-if="c.tank_before !== c.tank_after" class="font-medium text-ink"> → {{ fmt(c.tank_after) }}</span>
                </td>
                <td class="px-3 py-1.5 text-ink-secondary">
                  <span :class="c.mpg_before !== c.mpg_after ? 'text-ink-subtle line-through' : ''">{{ fmt(c.mpg_before) }}</span>
                  <span v-if="c.mpg_before !== c.mpg_after" class="font-medium text-ink"> → {{ fmt(c.mpg_after) }}</span>
                </td>
                <td class="px-3 py-1.5 text-ink-secondary">
                  <span v-if="c.equip_changed" class="font-medium text-ink">{{ equipLabel(c.apu_type_after ?? null, c.has_optimized_idle_after ?? null) }}</span>
                  <span v-else class="text-ink-subtle">—</span>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="preview.toUpdate.length > 50" class="px-3 py-2 text-xs text-ink-subtle">+{{ preview.toUpdate.length - 50 }} more…</p>
        </div>
      </div>

      <!-- No changes -->
      <div
        v-if="!preview.toCreate.length && !preview.toUpdate.length && !preview.errors.length"
        class="rounded-lg bg-surface-subtle px-4 py-4 text-center text-sm text-ink-muted ring-1 ring-edge"
      >
        No changes — all vehicles in this file are already up to date.
      </div>

      <!-- Action buttons -->
      <div class="flex items-center justify-between gap-3 border-t border-edge-subtle pt-4">
        <BaseButton variant="ghost" @click="preview = null">
          ← Choose another file
        </BaseButton>
        <BaseButton
          variant="primary"
          :disabled="commit.isPending.value || !actionCount"
          @click="onCommit"
        >
          {{ commit.isPending.value
              ? "Importing…"
              : actionCount
                ? `Import ${actionCount} vehicle${actionCount === 1 ? "" : "s"}`
                : "Nothing to import" }}
        </BaseButton>
      </div>

    </template>
  </div>
</template>
