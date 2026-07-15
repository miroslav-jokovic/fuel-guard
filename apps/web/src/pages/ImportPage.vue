<script setup lang="ts">
import { computed, ref } from "vue";
import { DocumentTextIcon, XMarkIcon } from "@heroicons/vue/20/solid";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import { useDriversQuery } from "@/features/fleet/useDrivers";
import { analyzeImport, useCommitImport, type ImportPreview } from "@/features/import/useImport";
import { useToastStore } from "@/stores/toast";
import { apiFetch } from "@/lib/api";
import { useQueryClient } from "@tanstack/vue-query";
import PageHeader from "@/components/ui/PageHeader.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import PriceUploadCard from "@/features/fueling/PriceUploadCard.vue";

const activeTab = ref<"efs" | "prices">("efs");

const { data: vehicles } = useVehiclesQuery();
const { data: drivers } = useDriversQuery();
const commit = useCommitImport();

const toast = useToastStore();
const analyzing = ref(false);

// Several reports can be queued at once (e.g. this week's Transaction + Reject
// files together) — each is analyzed on drop and reviewed as its own card.
const previews = ref<ImportPreview[]>([]);

async function onFiles(files: File[]) {
  analyzing.value = true;
  try {
    for (const file of files) {
      try {
        const p = await analyzeImport(file, vehicles.value ?? [], drivers.value ?? []);
        if (p.kind === "unknown") {
          toast.warning(
            "Unrecognized file",
            `Could not identify "${file.name}" as an EFS Transaction or Reject report. Make sure you're exporting a Transaction Detail or Reject/Decline report from EFS (.xlsx or .csv).`,
          );
        } else if (previews.value.some((x) => x.filename === p.filename)) {
          toast.info("Already queued", `"${p.filename}" is already in the review list below.`);
        } else {
          previews.value = [...previews.value, p];
        }
      } catch (err) {
        toast.error(`Could not read ${file.name}`, err instanceof Error ? err.message : undefined);
      }
    }
  } finally {
    analyzing.value = false;
  }
}

function removePreview(i: number) {
  previews.value = previews.value.filter((_, idx) => idx !== i);
}
const resetAll = () => {
  previews.value = [];
};

// Commit the queue in order; each file keeps its own success/shortfall toast.
// Committed files leave the list as they finish, so a mid-queue failure
// leaves exactly the unprocessed files behind.
const committingIndex = ref<number | null>(null);
async function onCommitAll() {
  const queue = [...previews.value];
  for (const p of queue) {
    committingIndex.value = 0;
    try {
      const result = await commit.mutateAsync(p);
      if (result.shortfallRows != null && result.shortfallRows > 0) {
        // Post-commit verification found rows that should have inserted but didn't — surface it NOW
        // instead of letting it show up weeks later as a hole in the dashboard.
        toast.warning(
          `${p.filename}: verified with a shortfall — ${result.shortfallRows} expected row(s) did not insert`,
          "Details were saved on the import record. Re-upload the file or contact support before trusting this period's data.",
        );
      } else {
        // The affected vehicles' neighboring fills are re-scored automatically after import (auto-cascade),
        // so MPG/over-fuel checks reflect the full history without a manual Rebuild.
        toast.success(`${p.filename} imported`, "New rows saved and scored; affected vehicles re-checked automatically.");
      }
      previews.value = previews.value.filter((x) => x !== p);
    } catch (err) {
      toast.error(`${p.filename}: import failed`, err instanceof Error ? err.message : undefined);
      break; // leave this file + the rest queued for review
    }
  }
  committingIndex.value = null;
}
const committing = computed(() => committingIndex.value !== null || commit.isPending.value);

const totalNewRows = computed(() =>
  previews.value.reduce((n, p) => n + (p.kind === "transaction" ? p.newFuel.length : p.newDeclined.length), 0),
);

// ── preview tables (first 10 lines, faithful to the uploaded file) ────────────
const txnColumns: DataTableColumn[] = [
  { key: "tran_date", label: "Tran Date", cellClass: "text-ink-secondary" },
  { key: "card_num", label: "Card #", cellClass: "text-ink-secondary" },
  { key: "unit", label: "Unit", cellClass: "font-medium text-ink" },
  { key: "driver_name", label: "Driver", cellClass: "text-ink-secondary" },
  { key: "odometer", label: "Odometer", numeric: true, cellClass: "text-ink-secondary" },
  { key: "location_name", label: "Location", cellClass: "text-ink-secondary" },
  { key: "item", label: "Item", cellClass: "text-ink-secondary" },
  { key: "qty", label: "Qty", numeric: true, cellClass: "text-ink-secondary" },
  { key: "amt", label: "Amt", numeric: true, cellClass: "text-ink-secondary" },
];
const rejColumns: DataTableColumn[] = [
  { key: "card_ref", label: "Card #", cellClass: "text-ink-secondary" },
  { key: "unit", label: "Unit", cellClass: "font-medium text-ink" },
  { key: "driver_name", label: "Driver", cellClass: "text-ink-secondary" },
  { key: "error_code", label: "Error", cellClass: "text-ink-secondary" },
  { key: "error_description", label: "Description", cellClass: "text-ink-secondary" },
];
const previewRows = (p: ImportPreview) =>
  (p.kind === "transaction" ? (p.allLines ?? []) : (p.newDeclined ?? []))
    .slice(0, 10)
    .map((l, i) => ({ ...l, _key: String(i) }));
const previewTotal = (p: ImportPreview) =>
  p.kind === "transaction" ? p.allLines.length : p.newDeclined.length;

// ── repair: re-derive fuel events from the stored EFS lines ────────────────────────────────────────
// The Transactions page reads the faithful EFS store; the dashboard reads derived fuel events. If the
// store is complete but the dashboard is missing days (a half-failed import, historical merge bug),
// this rebuilds the events from the store — no file re-upload needed.
const qc = useQueryClient();
const repairing = ref(false);
interface RepairResult {
  storeLines: number;
  derivedEvents: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skippedBlankInvoice: number;
  scoringQueued: number;
}
async function onRepair() {
  repairing.value = true;
  try {
    const res = await apiFetch<RepairResult>("/api/transactions/sync-from-efs", { method: "POST" });
    if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Repair request failed");
    const r = res.data;
    if (r.inserted === 0 && r.updated === 0) {
      toast.success("Fuel data verified", `All ${r.derivedEvents} fuel events match the stored EFS lines — nothing to repair.`);
    } else {
      toast.success(
        `Repaired fuel data: ${r.inserted} added, ${r.updated} corrected`,
        `${r.unchanged} already correct. ${r.scoringQueued} row(s) are being re-scored in the background.`,
      );
    }
    qc.invalidateQueries({ queryKey: ["fuel_transactions"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  } catch (err) {
    toast.error("Repair failed", err instanceof Error ? err.message : undefined);
  } finally {
    repairing.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-6">
    <PageHeader>Upload your fleet's reports and daily fuel prices.</PageHeader>

    <div class="flex gap-1 rounded-lg bg-surface-muted p-1 text-sm">
      <button
        class="rounded-md px-3 py-1.5 font-medium transition"
        :class="activeTab === 'efs' ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink-secondary'"
        @click="activeTab = 'efs'"
      >EFS reports</button>
      <button
        class="rounded-md px-3 py-1.5 font-medium transition"
        :class="activeTab === 'prices' ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink-secondary'"
        @click="activeTab = 'prices'"
      >Fuel prices</button>
    </div>

    <div v-show="activeTab === 'efs'" class="space-y-6">
      <p class="text-sm text-ink-muted">
        Upload EFS <strong>Transaction</strong> and <strong>Reject</strong> reports (.xlsx or .csv) — drop both
        at once and review them together. Fuel lines (diesel/gasoline) are imported; DEF, scales and fees are skipped.
      </p>

    <!-- Upload -->
    <FileDropzone
      accept=".xlsx,.xls,.csv"
      multiple
      :busy="analyzing"
      busy-label="Reading files…"
      label="Drag & drop your EFS reports here"
      hint=".xlsx or .csv · Transaction Detail and Reject/Decline reports · several files at once is fine"
      @files="onFiles"
    />

    <!-- Repair from stored data -->
    <BaseCard v-if="!previews.length" padding="sm" class="flex items-start justify-between gap-4">
      <div>
        <h4 class="text-sm font-semibold text-ink">Dashboard missing days?</h4>
        <p class="mt-1 text-xs text-ink-muted">
          If the Transactions page shows all your EFS data but dashboard graphs are missing days, the
          derived fuel events are out of sync with the stored report lines. This rebuilds them from the
          stored data — no file re-upload needed. Safe to run any time; it only adds or corrects rows.
        </p>
      </div>
      <button
        :disabled="repairing"
        class="shrink-0 rounded-md bg-surface px-3 py-2 text-sm font-semibold text-brand-600 ring-1 ring-brand-200 ring-inset hover:bg-brand-50 disabled:opacity-50"
        @click="onRepair"
      >
        {{ repairing ? "Repairing…" : "Repair fuel data" }}
      </button>
    </BaseCard>

    <!-- Review queue -->
    <template v-if="previews.length">
      <BaseCard v-for="(preview, i) in previews" :key="preview.filename" class="space-y-5">
        <!-- Duplicate-file warning -->
        <div v-if="preview.alreadyImported" class="flex items-start gap-3 rounded-md bg-warning-50 px-4 py-3 text-sm text-warning-800 ring-1 ring-warning-200">
          <span class="mt-0.5 shrink-0 text-warning-500">⚠</span>
          <p>
            <strong>This file was already imported.</strong>
            Re-committing is safe: rows already in FuelGuard are skipped, and any rows that are missing
            (e.g. from an earlier partial import) will be added. Check "New fill-ups" below — if it shows 0
            but the dashboard is missing days, use <em>Repair fuel data</em> instead.
          </p>
        </div>

        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 class="flex flex-wrap items-center gap-2 text-base font-semibold text-ink">
              <DocumentTextIcon class="size-5 shrink-0 text-ink-subtle" aria-hidden="true" />
              <span class="truncate">{{ preview.filename }}</span>
              <span :class="[BADGE_BASE, toneClass(preview.kind === 'reject' ? 'warning' : 'brand')]">
                {{ preview.kind === "reject" ? "Reject report" : "Transaction report" }}
              </span>
            </h3>
            <p class="mt-0.5 text-sm text-ink-muted">
              {{ preview.source.toUpperCase() }} · {{ preview.totalRows }} rows
              <span v-if="preview.reportFrom" class="text-ink-subtle"> · {{ preview.reportFrom }} → {{ preview.reportTo }}</span>
            </p>
            <p class="mt-1 text-xs text-ink-subtle">
              Rows already in FuelGuard are detected and skipped automatically — safe to upload an overlapping period.
            </p>
          </div>
          <button
            type="button"
            class="shrink-0 rounded-md p-1 text-ink-subtle hover:bg-surface-muted hover:text-ink-secondary"
            :aria-label="`Remove ${preview.filename} from the queue`"
            :disabled="committing"
            @click="removePreview(i)"
          >
            <XMarkIcon class="size-5" aria-hidden="true" />
          </button>
        </div>

        <dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <template v-if="preview.kind === 'transaction'">
            <div class="rounded-md bg-surface-subtle p-3">
              <dt class="text-xs text-ink-muted">New fill-ups</dt>
              <dd class="text-2xl font-semibold text-ink">{{ preview.newFuel.length }}</dd>
            </div>
            <div class="rounded-md bg-surface-subtle p-3">
              <dt class="text-xs text-ink-muted">Duplicates</dt>
              <dd class="text-2xl font-semibold text-ink-muted">{{ preview.duplicateFuelCount }}</dd>
            </div>
            <div class="rounded-md bg-warning-50 p-3">
              <dt class="text-xs text-warning-700">Unattributed</dt>
              <dd class="text-2xl font-semibold text-warning-800">{{ preview.unattributedCount }}</dd>
            </div>
            <div class="rounded-md bg-surface-subtle p-3">
              <dt class="text-xs text-ink-muted">Non-fuel skipped</dt>
              <dd class="text-2xl font-semibold text-ink-muted">{{ preview.skippedCount }}</dd>
            </div>
          </template>
          <template v-else>
            <div class="rounded-md bg-surface-subtle p-3">
              <dt class="text-xs text-ink-muted">New declined</dt>
              <dd class="text-2xl font-semibold text-ink">{{ preview.newDeclined.length }}</dd>
            </div>
            <div class="rounded-md bg-surface-subtle p-3">
              <dt class="text-xs text-ink-muted">Duplicates</dt>
              <dd class="text-2xl font-semibold text-ink-muted">{{ preview.duplicateDeclinedCount }}</dd>
            </div>
          </template>
        </dl>

        <p v-if="preview.kind === 'transaction' && preview.unattributedCount > 0" class="text-xs text-warning-700">
          {{ preview.unattributedCount }} fill-up(s) couldn't be matched to a vehicle by Unit number —
          they'll import as unattributed. Check that vehicle unit numbers match EFS.
        </p>

        <!-- Faithful preview of the uploaded data (first rows) -->
        <div v-if="previewTotal(preview) > 0" class="space-y-1">
          <p class="text-xs font-medium text-ink-muted">
            Preview (first {{ Math.min(previewTotal(preview), 10) }} of {{ previewTotal(preview) }})
          </p>
          <DataTable
            dense
            :sticky-header="false"
            :columns="preview.kind === 'transaction' ? txnColumns : rejColumns"
            :rows="previewRows(preview)"
            row-key="_key"
          />
        </div>
      </BaseCard>

      <!-- Queue actions -->
      <BaseCard padding="sm" class="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        <p class="text-sm text-ink-muted">
          {{ previews.length }} file{{ previews.length > 1 ? "s" : "" }} ready ·
          <span class="font-medium text-ink">{{ totalNewRows.toLocaleString() }} new row(s)</span> to import
        </p>
        <div class="flex justify-end gap-3">
          <BaseButton :disabled="committing" @click="resetAll">Cancel all</BaseButton>
          <BaseButton variant="primary" :disabled="committing || previews.length === 0" @click="onCommitAll">
            {{ committing ? "Importing…" : previews.length > 1 ? `Commit ${previews.length} imports` : "Commit import" }}
          </BaseButton>
        </div>
      </BaseCard>
    </template>
    </div>

    <div v-if="activeTab === 'prices'" class="space-y-4">
      <PriceUploadCard />
    </div>
  </div>
</template>
