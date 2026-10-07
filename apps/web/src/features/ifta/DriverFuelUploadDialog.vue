<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  AppButton as BaseButton, AppCallout, AppCard as BaseCard, AppCombobox as ComboSelect, AppFormField, AppTextarea,
} from "@silvicom/ui";
import { STATE_NAMES, gal, type IftaReceiptUploadResponse, type IftaTruckBasis } from "@silvicom/shared";
import BaseModal from "@/components/ui/BaseModal.vue";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { formatDate, formatDateTime } from "@/lib/format";
import { useToastStore } from "@/stores/toast";
import {
  fileToBase64, tooLarge, useReceiptUpload, useReceiptUploadsQuery, useVoidReceiptUpload,
} from "./useReceiptUploads";

/**
 * Driver-paid fuel into the IFTA credit (IFTA-PRECISION-PLAN IP8, D-IP7): drop a file, read what it
 * would add, answer the trucks it cannot decide, import. Below it, the uploads so far, each one
 * undoable — a wrong file is voided whole, never edited, because these rows are tax evidence.
 *
 * Nothing is imported from the drop itself. The preview is the server's own answer for this file,
 * and the import button lands exactly those rows; a choice of truck re-asks the server, so the
 * table always shows what the import will do, never what the browser guessed it would.
 */
const props = defineProps<{ open: boolean; canManage: boolean }>();
const emit = defineEmits<{ close: [] }>();
const toast = useToastStore();

const file = ref<File | null>(null);
const content = ref<string | null>(null);
const preview = ref<IftaReceiptUploadResponse | null>(null);
const choices = ref<Record<string, string>>({});
const upload = useReceiptUpload();
const uploads = useReceiptUploadsQuery();
const voider = useVoidReceiptUpload();
const { data: vehicles } = useVehiclesQuery();

const truckOptions = computed(() =>
  (vehicles.value ?? []).map((v) => ({ value: v.id, label: `Unit ${v.unit_number}` })),
);

function reset() {
  file.value = null;
  content.value = null;
  preview.value = null;
  choices.value = {};
}
watch(() => props.open, (open) => { if (!open) reset(); });

async function ask(commit: boolean) {
  if (!file.value || !content.value) return;
  try {
    const r = await upload.mutateAsync({
      fileName: file.value.name, contentBase64: content.value, commit, truckChoices: choices.value,
    });
    if (!r.committed) {
      preview.value = r;
      return;
    }
    const n = r.committed.imported;
    const g = r.rows.filter((x) => x.status === "new").reduce((s, x) => s + x.gallons, 0);
    toast.success(`Imported ${n} fill${n === 1 ? "" : "s"}`, `${gal(g)} gal added to the IFTA credit.`);
    reset();
  } catch (e) {
    toast.error(commit ? "Import failed" : "Couldn't read this file", e instanceof Error ? e.message : undefined);
  }
}

async function onFiles(files: File[]) {
  const f = files[0];
  if (!f) return;
  if (tooLarge(f)) {
    toast.error("File too large", "Split it into quarters and upload each one.");
    return;
  }
  reset();
  file.value = f;
  content.value = await fileToBase64(f);
  await ask(false);
}

/** A truck chosen for a question re-asks the server, so the table shows what the import will do. */
async function choose(key: string, vehicleId: string) {
  choices.value = { ...choices.value, [key]: vehicleId };
  await ask(false);
}

const BASIS: Record<IftaTruckBasis, string> = {
  unit_in_file: "unit in the file",
  driver_assignment: "driver's truck that day (Samsara)",
  chosen_at_upload: "chosen here",
};
const STATUS = { new: "Will import", already_present: "Already imported", needs_truck: "Needs a truck" } as const;

const counts = computed(() => {
  const rows = preview.value?.rows ?? [];
  const of = (s: string) => rows.filter((r) => r.status === s);
  const days = rows.map((r) => r.fueledOn).sort();
  return {
    total: rows.length,
    gallons: rows.reduce((s, r) => s + r.gallons, 0),
    newRows: of("new"),
    present: of("already_present").length,
    waiting: of("needs_truck").length,
    from: days[0] ?? null,
    to: days[days.length - 1] ?? null,
  };
});
const disagreeing = computed(() => (preview.value?.statedTotals ?? []).filter((t) => !t.agrees));
const canImport = computed(() =>
  props.canManage && !!preview.value && counts.value.waiting === 0 && counts.value.newRows.length > 0 && disagreeing.value.length === 0,
);

const previewRows = computed(() =>
  (preview.value?.rows ?? []).map((r) => ({
    id: String(r.line),
    line: r.line,
    date: formatDate(r.fueledOn),
    state: STATE_NAMES[r.jurisdiction] ?? r.jurisdiction,
    gallons: gal(r.gallons),
    station: r.station ?? "—",
    truck: r.unitNumber ? `Unit ${r.unitNumber}` : (r.unitAsFiled ? `“${r.unitAsFiled}”` : (r.driverAsFiled ?? "—")),
    basis: r.truckBasis ? BASIS[r.truckBasis] : "",
    status: STATUS[r.status],
  })),
);
const previewCols: DataTableColumn[] = [
  { key: "line", label: "Line", numeric: true, width: "xs" },
  { key: "date", label: "Date", width: "sm" },
  { key: "state", label: "State", width: "sm" },
  { key: "gallons", label: "Gallons", numeric: true, width: "sm" },
  { key: "station", label: "Station", width: "lg" },
  { key: "truck", label: "Truck", width: "md" },
  { key: "status", label: "", width: "sm" },
];

const undoing = ref<string | null>(null);
const undoReason = ref("");
async function confirmUndo() {
  if (!undoing.value) return;
  try {
    const n = await voider.mutateAsync({ id: undoing.value, reason: undoReason.value });
    toast.success("Upload undone", `${n} fill${n === 1 ? "" : "s"} no longer count toward the IFTA credit.`);
    undoing.value = null;
    undoReason.value = "";
  } catch (e) {
    toast.error("Couldn't undo the upload", e instanceof Error ? e.message : undefined);
  }
}
const uploadRows = computed(() =>
  (uploads.data.value ?? []).map((u) => ({
    id: u.id,
    file: u.fileName,
    when: formatDateTime(u.uploadedAt),
    fills: u.rowsImported.toLocaleString("en-US"),
    gallons: gal(u.gallons),
    span: u.firstDay ? `${formatDate(u.firstDay)} – ${formatDate(u.lastDay)}` : "—",
    state: u.voidedAt ? `Undone: ${u.voidReason ?? ""}` : "Counted",
    live: !u.voidedAt,
  })),
);
const uploadCols: DataTableColumn[] = [
  { key: "file", label: "File", width: "lg" },
  { key: "when", label: "Uploaded", width: "md" },
  { key: "fills", label: "Fills", numeric: true, width: "xs" },
  { key: "gallons", label: "Gallons", numeric: true, width: "sm" },
  { key: "span", label: "Fill dates", width: "md" },
  { key: "state", label: "", width: "md" },
];
</script>

<template>
  <BaseModal
    :open="open"
    size="xl"
    title="Driver-paid fuel"
    description="Fuel drivers paid for themselves (cash, their own card, a fuel app) counts toward the IFTA credit once it is here. Upload the fuel app's IFTA report (.csv) or McLeod's Fuel Ticket Hist Listing (.xlsx)."
    @close="emit('close')"
  >
    <div class="space-y-4">
      <FileDropzone
        v-if="canManage"
        accept=".csv,.xlsx"
        label="Drop a fuel file here, or click to choose one"
        hint="Uploading the same file again only adds rows that are not already here."
        :busy="upload.isPending.value"
        busy-label="Reading the file…"
        @files="onFiles"
      />
      <p v-else class="text-sm text-ink-tertiary">Only people who manage fuel can upload. The uploads so far are below.</p>

      <template v-if="preview">
        <p class="text-sm text-ink-secondary" data-testid="upload-summary">
          {{ preview.fileName }}: {{ counts.total }} fill{{ counts.total === 1 ? "" : "s" }}, {{ gal(counts.gallons) }} gal<template v-if="counts.from">,
          {{ formatDate(counts.from) }} – {{ formatDate(counts.to) }}</template>.
          {{ counts.newRows.length }} will import<template v-if="counts.present">, {{ counts.present }} already imported</template><template v-if="counts.waiting">, {{ counts.waiting }} need a truck</template>.
        </p>

        <AppCallout v-if="disagreeing.length" tone="danger" data-testid="totals-disagree">
          The file's own totals don't match the fills we read
          ({{ disagreeing.map((t) => `${t.jurisdiction ?? "all states"}: file says ${gal(t.stated)} gal, rows add up to ${gal(t.parsed)}`).join("; ") }}).
          Nothing will import until the file is fixed; check the export in the app it came from.
        </AppCallout>
        <AppCallout v-if="preview.refused.length" tone="caution" data-testid="refused">
          {{ preview.refused.length }} line{{ preview.refused.length === 1 ? "" : "s" }} will not import:
          {{ preview.refused.map((r) => `line ${r.line}, ${r.reason}`).join("; ") }}.
        </AppCallout>
        <p v-if="preview.voidedInSource" class="text-xs text-ink-tertiary">
          {{ preview.voidedInSource }} ticket{{ preview.voidedInSource === 1 ? " was" : "s were" }} voided in McLeod and skipped.
        </p>

        <div v-for="q in preview.truckQuestions" :key="q.key" class="rounded-surface p-3 ring-1 ring-edge" data-testid="truck-question">
          <AppFormField
            :label="`Which truck is ${q.label}? (${q.rows} fill${q.rows === 1 ? '' : 's'})`"
            :hint="q.suggestion?.unitNumber ? `${q.why} The other evidence points at unit ${q.suggestion.unitNumber}.` : q.why"
          >
            <ComboSelect
              :model-value="choices[q.key] ?? ''"
              :options="truckOptions"
              placeholder="Choose a truck"
              @update:model-value="(v: string) => choose(q.key, v)"
            />
          </AppFormField>
        </div>

        <BaseCard padding="none">
          <DataTable :columns="previewCols" :rows="previewRows" row-key="id" empty-text="No fills in this file.">
            <template #cell-truck="{ row }">
              {{ row.truck }}
              <span v-if="row.basis" class="block text-xs text-ink-tertiary">{{ row.basis }}</span>
            </template>
          </DataTable>
        </BaseCard>

        <div class="flex justify-end gap-2">
          <BaseButton @click="reset">Choose another file</BaseButton>
          <BaseButton variant="primary" :disabled="!canImport || upload.isPending.value" @click="ask(true)">
            Import {{ counts.newRows.length }} fill{{ counts.newRows.length === 1 ? "" : "s" }}
          </BaseButton>
        </div>
      </template>

      <section class="space-y-2">
        <h3 class="text-sm font-semibold text-ink">Uploads so far</h3>
        <BaseCard padding="none">
          <DataTable :columns="uploadCols" :rows="uploadRows" row-key="id" empty-text="Nothing uploaded yet.">
            <template #cell-state="{ row }">
              <span v-if="!row.live" class="text-xs text-ink-tertiary">{{ row.state }}</span>
              <BaseButton v-else-if="canManage" size="sm" variant="ghost" @click="undoing = String(row.id)">Undo</BaseButton>
              <span v-else class="text-xs text-ink-tertiary">Counted</span>
            </template>
          </DataTable>
        </BaseCard>
        <div v-if="undoing" class="space-y-2 rounded-surface p-3 ring-1 ring-edge" data-testid="undo-form">
          <AppFormField label="Why is this upload wrong?" hint="Kept with the record. Its fills stop counting; the file can be uploaded again once fixed.">
            <AppTextarea v-model="undoReason" />
          </AppFormField>
          <div class="flex justify-end gap-2">
            <BaseButton @click="undoing = null">Keep it</BaseButton>
            <BaseButton variant="danger" :disabled="undoReason.trim().length < 3 || voider.isPending.value" @click="confirmUndo">
              Undo upload
            </BaseButton>
          </div>
        </div>
      </section>
    </div>
  </BaseModal>
</template>
