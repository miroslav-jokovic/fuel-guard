<script setup lang="ts">
import StatCard from "@/components/ui/StatCard.vue";
import { AppCallout, AppIcon } from "@silvicom/ui";
import {
  CsvIcon,
} from "@silvicom/ui/icons";
import { ref, computed } from "vue";
import type { Vehicle } from "@silvicom/shared";
import {
  buildVehicleImportTemplate,
  buildSetupCsv,
  analyzeVehicleImportFile,
  useCommitVehicleImport,
  type VehicleImportPreview,
} from "./useVehicleSetupImport";
import { useToastStore } from "@/stores/toast";
import { AppButton as BaseButton } from "@silvicom/ui";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";

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
async function onFile(files: File[]) {
  const file = files[0];
  if (!file) return;
  reading.value = true;
  try {
    preview.value = await analyzeVehicleImportFile(file, props.vehicles);
  } catch (err) {
    toast.error("Could not read file", err instanceof Error ? err.message : undefined);
  } finally {
    reading.value = false;
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
/** null when nothing is known, so the table's own em dash shows it. */
const equipLabel  = (apu: string | null, opt: boolean | null): string | null => {
  const parts: string[] = [];
  if (apu && apu !== "none") parts.push(apu);
  if (opt) parts.push("Optimized idle");
  if (parts.length) return parts.join(" + ");
  return apu === "none" ? "None" : null;
};

// ── tables (D-US4: drawn by DataTable, never a hand-styled <table>) ──────────
type Need = "yes" | "new" | "recommended" | "no";
const NEED_LABEL: Record<Need, string> = { yes: "Yes", new: "New only", recommended: "Recommended", no: "No" };
const NEED_TONE: Record<Need, string> = {
  yes: "font-medium text-danger-600",
  new: "font-medium text-danger-600",
  recommended: "font-medium text-warning-600",
  no: "text-ink-tertiary",
};
const FIELD_REFERENCE: Array<{ column: string; need: Need; notes: string }> = [
  { column: "unit_number", need: "yes", notes: "Unique truck ID (e.g. T-101). Used to match existing vehicles." },
  { column: "fuel_type", need: "new", notes: "diesel / gasoline / def / electric / other" },
  { column: "make", need: "no", notes: "e.g. Freightliner, Ford, Kenworth" },
  { column: "model", need: "no", notes: "e.g. Cascadia, F-450, T680" },
  { column: "year", need: "no", notes: "4-digit model year (e.g. 2021)" },
  { column: "plate", need: "no", notes: "License plate number" },
  { column: "vin", need: "no", notes: "17-character VIN" },
  { column: "tank_capacity_gal", need: "recommended", notes: "Full tank size in gallons. Required for theft detection." },
  { column: "baseline_mpg", need: "recommended", notes: "Average MPG. Required for consumption anomaly rules." },
  { column: "current_odometer", need: "no", notes: "Current odometer reading in miles" },
  { column: "status", need: "no", notes: "active / maintenance / retired (default: active)" },
  { column: "apu_type", need: "no", notes: "diesel_apu / battery_hvac / fuel_heater / shore_power / none — idle-reduction equipment" },
  { column: "has_optimized_idle", need: "no", notes: "yes / no — OEM optimized idle (e.g. Freightliner Cascadia)" },
];
const referenceColumns: DataTableColumn[] = [
  { key: "column", label: "Column", cellClass: "font-mono text-ink" },
  { key: "need", label: "Required" },
  { key: "notes", label: "Notes" },
];

const PREVIEW_LIMIT = 50;
const createColumns: DataTableColumn[] = [
  { key: "unit_number", label: "Unit", cellClass: "font-medium text-ink" },
  { key: "fuel_type", label: "Fuel type", cellClass: "capitalize" },
  { key: "make_model_year", label: "Make / Model / Year" },
  { key: "plate_vin", label: "Plate / VIN" },
  { key: "tank", label: "Tank (gal)", numeric: true },
  { key: "baseline_mpg", label: "MPG", numeric: true },
  { key: "odometer", label: "Odometer", numeric: true },
  { key: "status", label: "Status", cellClass: "capitalize" },
  { key: "idle", label: "Idle equipment" },
];
const createRows = computed(() =>
  (preview.value?.toCreate ?? []).slice(0, PREVIEW_LIMIT).map((r) => ({
    ...r,
    make_model_year: [r.make, r.model, r.year].filter(Boolean).join(" ") || null,
    // A zero tank or odometer is "not given" in the template, not a reading.
    tank: r.tank_capacity_gal || null,
    odometer: r.current_odometer ? r.current_odometer.toLocaleString() : null,
    idle: equipLabel(r.apu_type, r.has_optimized_idle),
  })),
);

const updateColumns: DataTableColumn[] = [
  { key: "unit_number", label: "Unit", cellClass: "font-medium text-ink" },
  { key: "tank", label: "Tank (gal)", numeric: true },
  { key: "mpg", label: "Baseline MPG", numeric: true },
  { key: "idle", label: "Idle equipment", cellClass: "font-medium text-ink" },
];
const updateRows = computed(() =>
  (preview.value?.toUpdate ?? []).slice(0, PREVIEW_LIMIT).map((c) => ({
    ...c,
    idle: c.equip_changed ? equipLabel(c.apu_type_after ?? null, c.has_optimized_idle_after ?? null) : null,
  })),
);
</script>

<template>
  <div class="space-y-5">

    <!-- ── UPLOAD STATE ── -->
    <template v-if="!preview">

      <!-- How-to steps -->
      <ol class="space-y-1 rounded-surface bg-brand-50 px-4 py-3 text-sm text-brand-800 ring-1 ring-brand-100 list-decimal list-inside">
        <li>Download the blank template below and open it in Excel / Google Sheets</li>
        <li>Delete the two example rows and enter your vehicle data</li>
        <li>Save as CSV or Excel and upload it here</li>
        <li>Review the preview and confirm the import</li>
      </ol>

      <!-- Download buttons -->
      <div class="grid grid-cols-2 gap-3">
        <BaseButton
          class="flex flex-col items-center gap-2 rounded-surface border-2 border-dashed border-brand-300 px-4 py-5 text-center transition-colors hover:border-brand-400 hover:bg-brand-50"
          @click="downloadTemplate"
        >
          <AppIcon :icon="CsvIcon" class="size-6 text-brand-500" aria-hidden="true" />
          <span class="text-sm font-semibold text-brand-700">Blank template</span>
          <span class="text-xs text-ink-muted">All fields · 2 example rows</span>
        </BaseButton>
        <BaseButton
          class="flex flex-col items-center gap-2 rounded-surface border-2 border-dashed border-edge-control px-4 py-5 text-center transition-colors hover:border-edge-control hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!vehicles.length"
          :title="vehicles.length ? 'Export current fleet — fill in tank / MPG and re-import' : 'No vehicles yet'"
          @click="downloadCurrentFleet"
        >
          <AppIcon :icon="CsvIcon" class="size-6 text-ink-tertiary" aria-hidden="true" />
          <span class="text-sm font-semibold text-ink-secondary">Current fleet</span>
          <span class="text-xs text-ink-muted">Edit tank / MPG / idle equipment</span>
        </BaseButton>
      </div>

      <!-- Field reference -->
      <details class="rounded-surface bg-surface-subtle ring-1 ring-edge">
        <summary class="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-ink-secondary">
          CSV field reference ▾
        </summary>
        <div class="border-t border-edge">
          <DataTable
            embedded
            dense
            :sticky-header="false"
            :nowrap="false"
            :columns="referenceColumns"
            :rows="FIELD_REFERENCE"
            row-key="column"
          >
            <template #cell-need="{ row }">
              <span :class="NEED_TONE[row.need as Need]">{{ NEED_LABEL[row.need as Need] }}</span>
            </template>
          </DataTable>
          <p class="px-4 pb-3 pt-2 text-xs text-ink-muted">
            Existing vehicles are matched by <strong>unit_number</strong> — <em>tank_capacity_gal</em>, <em>baseline_mpg</em>, and idle equipment (<em>apu_type</em>, <em>has_optimized_idle</em>) are updated.
            Unrecognised units create new vehicles.
          </p>
        </div>
      </details>

      <!-- File upload zone -->
      <FileDropzone
        accept=".csv,.xlsx,.xls"
        :busy="reading"
        label="Choose CSV or Excel file"
        hint="Upload the completed template to preview and validate before importing"
        @files="onFile"
      />

    </template>

    <!-- ── PREVIEW STATE ── -->
    <template v-else>

      <!-- Filename -->
      <p class="truncate text-xs text-ink-muted">
        File: <strong class="text-ink-secondary">{{ preview.filename }}</strong>
        <span class="ml-2 text-ink-tertiary">{{ preview.totalRows }} data row{{ preview.totalRows === 1 ? "" : "s" }}</span>
      </p>

      <!-- Summary stats -->
      <!-- A count only takes its verdict colour once there is something to count; at zero it is muted. -->
      <div class="grid grid-cols-3 gap-3">
        <StatCard label="New vehicles" :value="preview.toCreate.length" :value-tone="preview.toCreate.length ? 'text-success-800' : undefined" :muted="!preview.toCreate.length" />
        <StatCard label="Setup updates" :value="preview.toUpdate.length" :value-tone="preview.toUpdate.length ? 'text-brand-800' : undefined" :muted="!preview.toUpdate.length" />
        <StatCard label="Errors" :value="preview.errors.length" :value-tone="preview.errors.length ? 'text-danger-800' : undefined" :muted="!preview.errors.length" />
      </div>

      <!-- Errors -->
      <AppCallout v-if="preview.errors.length" tone="danger">
        <ul class="max-h-28 overflow-y-auto text-xs font-normal">
          <li v-for="(err, i) in preview.errors" :key="i">{{ err }}</li>
        </ul>
      </AppCallout>

      <!-- New vehicles table -->
      <div v-if="preview.toCreate.length" class="overflow-hidden rounded-surface ring-1 ring-edge">
        <div class="bg-success-50 px-3 py-2 text-xs font-semibold text-success-800 border-b border-success-100">
          New vehicles ({{ preview.toCreate.length }})
        </div>
        <DataTable
          embedded
          dense
          :sticky-header="false"
          :columns="createColumns"
          :rows="createRows"
          row-key="unit_number"
        >
          <template #cell-plate_vin="{ row }">
            <div v-if="row.plate">{{ row.plate }}</div>
            <div v-if="row.vin" class="font-mono">{{ row.vin }}</div>
            <span v-if="!row.plate && !row.vin" class="text-ink-tertiary">—</span>
          </template>
        </DataTable>
        <p v-if="preview.toCreate.length > PREVIEW_LIMIT" class="px-3 py-2 text-xs text-ink-tertiary">+{{ preview.toCreate.length - PREVIEW_LIMIT }} more…</p>
      </div>

      <!-- Setup updates table -->
      <div v-if="preview.toUpdate.length" class="overflow-hidden rounded-surface ring-1 ring-edge">
        <div class="bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-800 border-b border-brand-100">
          Setup updates ({{ preview.toUpdate.length }}) — existing vehicles, tank &amp; MPG only
        </div>
        <DataTable
          embedded
          dense
          :sticky-header="false"
          :columns="updateColumns"
          :rows="updateRows"
          row-key="id"
        >
          <template #cell-tank="{ row }">
            <span :class="row.tank_before !== row.tank_after ? 'text-ink-tertiary line-through' : ''">{{ fmt(row.tank_before) }}</span>
            <span v-if="row.tank_before !== row.tank_after" class="font-medium text-ink"> → {{ fmt(row.tank_after) }}</span>
          </template>
          <template #cell-mpg="{ row }">
            <span :class="row.mpg_before !== row.mpg_after ? 'text-ink-tertiary line-through' : ''">{{ fmt(row.mpg_before) }}</span>
            <span v-if="row.mpg_before !== row.mpg_after" class="font-medium text-ink"> → {{ fmt(row.mpg_after) }}</span>
          </template>
        </DataTable>
        <p v-if="preview.toUpdate.length > PREVIEW_LIMIT" class="px-3 py-2 text-xs text-ink-tertiary">+{{ preview.toUpdate.length - PREVIEW_LIMIT }} more…</p>
      </div>

      <!-- No changes -->
      <div
        v-if="!preview.toCreate.length && !preview.toUpdate.length && !preview.errors.length"
        class="rounded-surface bg-surface-subtle px-4 py-4 text-center text-sm text-ink-muted ring-1 ring-edge"
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
