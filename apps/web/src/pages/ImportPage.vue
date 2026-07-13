<script setup lang="ts">
import { ref } from "vue";
import { ArrowUpTrayIcon } from "@heroicons/vue/24/outline";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import { useDriversQuery } from "@/features/fleet/useDrivers";
import { analyzeImport, useCommitImport, type ImportPreview } from "@/features/import/useImport";
import { useToastStore } from "@/stores/toast";
import { apiFetch } from "@/lib/api";
import { useQueryClient } from "@tanstack/vue-query";
import PageHeader from "@/components/ui/PageHeader.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import DataTable from "@/components/ui/DataTable.vue";

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
    const result = await commit.mutateAsync(preview.value);
    if (result.shortfallRows != null && result.shortfallRows > 0) {
      // Post-commit verification found rows that should have inserted but didn't — surface it NOW
      // instead of letting it show up weeks later as a hole in the dashboard.
      toast.warning(
        `Import verified with a shortfall: ${result.shortfallRows} expected row(s) did not insert`,
        "Details were saved on the import record. Re-upload the file or contact support before trusting this period's data.",
      );
    } else {
      // The affected vehicles' neighboring fills are re-scored automatically after import (auto-cascade),
      // so MPG/over-fuel checks reflect the full history without a manual Rebuild.
      toast.success("Import complete", "New rows saved and scored; affected vehicles re-checked automatically.");
    }
    preview.value = null;
  } catch (err) {
    toast.error("Import failed", err instanceof Error ? err.message : undefined);
  }
}

const reset = () => {
  preview.value = null;
};

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
    <PageHeader>
      Upload an EFS <strong>Transaction</strong> or <strong>Reject</strong> report (.xlsx or .csv).
      Fuel lines (diesel/gasoline) are imported; DEF, scales and fees are skipped.
    </PageHeader>

    <!-- Upload -->
    <div
      v-if="!preview"
      class="rounded-lg border-2 border-dashed border-edge-strong bg-surface px-6 py-12 text-center"
    >
      <ArrowUpTrayIcon class="mx-auto size-10 text-ink-subtle" aria-hidden="true" />
      <label class="mt-4 inline-block cursor-pointer">
        <span
          class="rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-ink-inverse shadow-sm hover:bg-brand-500"
          >{{ analyzing ? "Reading…" : "Choose EFS file" }}</span
        >
        <input type="file" accept=".xlsx,.xls,.csv" class="sr-only" :disabled="analyzing" @change="onFile" />
      </label>
      <p class="mt-2 text-xs text-ink-subtle">.xlsx or .csv</p>
    </div>

    <!-- Repair from stored data -->
    <BaseCard v-if="!preview" padding="sm" class="flex items-start justify-between gap-4">
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

    <!-- Review -->
    <BaseCard v-if="preview" class="space-y-5">

      <!-- Duplicate-file warning -->
      <div v-if="preview.alreadyImported" class="flex items-start gap-3 rounded-md bg-warning-50 px-4 py-3 text-sm text-warning-800 ring-1 ring-warning-200">
        <span class="mt-0.5 shrink-0 text-warning-500">⚠</span>
        <p>
          <strong>This file was already imported.</strong>
          Re-committing is safe: rows already in FuelGuard are skipped, and any rows that are missing
          (e.g. from an earlier partial import) will be added. Check "New fill-ups" below — if it shows 0
          but the dashboard is missing days, use <em>Repair fuel data</em> on the upload screen instead.
        </p>
      </div>

      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-base font-semibold text-ink">Review import</h3>
          <p class="text-sm text-ink-muted">
            {{ preview.filename }} · {{ preview.kind === "reject" ? "Reject report" : "Transaction report" }}
            ({{ preview.source.toUpperCase() }}) · {{ preview.totalRows }} rows
            <span v-if="preview.reportFrom" class="text-ink-subtle"> · {{ preview.reportFrom }} → {{ preview.reportTo }}</span>
          </p>
          <p class="mt-1 text-xs text-ink-subtle">
            Rows already in FuelGuard are detected and skipped automatically — safe to upload an overlapping period.
          </p>
        </div>
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
      <div v-if="preview.kind === 'transaction' && preview.allLines.length" class="space-y-1">
        <p class="text-xs font-medium text-ink-muted">Preview (first {{ Math.min(preview.allLines.length, 10) }} of {{ preview.allLines.length }} lines)</p>
        <DataTable dense>
          <template #head>
            <tr>
              <th class="px-3 py-2 font-medium">Tran Date</th><th class="px-3 py-2 font-medium">Card #</th><th class="px-3 py-2 font-medium">Unit</th>
              <th class="px-3 py-2 font-medium">Driver</th><th class="px-3 py-2 font-medium">Odometer</th><th class="px-3 py-2 font-medium">Location</th>
              <th class="px-3 py-2 font-medium">Item</th><th class="px-3 py-2 font-medium">Qty</th><th class="px-3 py-2 font-medium">Amt</th>
            </tr>
          </template>
          <tr v-for="(l, i) in preview.allLines.slice(0, 10)" :key="i">
            <td class="px-3 py-1.5 text-ink-secondary">{{ l.tran_date }}</td>
            <td class="px-3 py-1.5 text-ink-secondary">{{ l.card_num }}</td>
            <td class="px-3 py-1.5 font-medium text-ink">{{ l.unit }}</td>
            <td class="px-3 py-1.5 text-ink-secondary">{{ l.driver_name }}</td>
            <td class="px-3 py-1.5 text-ink-secondary">{{ l.odometer }}</td>
            <td class="px-3 py-1.5 text-ink-secondary">{{ l.location_name }}</td>
            <td class="px-3 py-1.5 text-ink-secondary">{{ l.item }}</td>
            <td class="px-3 py-1.5 text-ink-secondary">{{ l.qty }}</td>
            <td class="px-3 py-1.5 text-ink-secondary">{{ l.amt }}</td>
          </tr>
        </DataTable>
      </div>
      <div v-else-if="preview.kind === 'reject' && preview.newDeclined.length" class="space-y-1">
        <p class="text-xs font-medium text-ink-muted">Preview (first {{ Math.min(preview.newDeclined.length, 10) }} of {{ preview.newDeclined.length }})</p>
        <DataTable dense>
          <template #head>
            <tr><th class="px-3 py-2 font-medium">Card #</th><th class="px-3 py-2 font-medium">Unit</th><th class="px-3 py-2 font-medium">Driver</th><th class="px-3 py-2 font-medium">Error</th><th class="px-3 py-2 font-medium">Description</th></tr>
          </template>
          <tr v-for="(d, i) in preview.newDeclined.slice(0, 10)" :key="i">
            <td class="px-3 py-1.5 text-ink-secondary">{{ d.card_ref }}</td>
            <td class="px-3 py-1.5 font-medium text-ink">{{ d.unit }}</td>
            <td class="px-3 py-1.5 text-ink-secondary">{{ d.driver_name }}</td>
            <td class="px-3 py-1.5 text-ink-secondary">{{ d.error_code }}</td>
            <td class="px-3 py-1.5 text-ink-secondary">{{ d.error_description }}</td>
          </tr>
        </DataTable>
      </div>

      <div class="flex justify-end gap-3">
        <BaseButton @click="reset">Cancel</BaseButton>
        <BaseButton variant="primary" :disabled="commit.isPending.value" @click="onCommit">
          {{ commit.isPending.value ? "Importing…" : "Commit import" }}
        </BaseButton>
      </div>
    </BaseCard>
  </div>
</template>
