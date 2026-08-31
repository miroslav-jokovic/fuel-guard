<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  PSP_IMPORT_CONSENT_ATTESTATION,
  PSP_SOURCE_LABELS,
  canReadInvestigationHistory,
  hasStructuredPspData,
  pspRecordSource,
  rolesThatManage,
  type QualificationRecordRow,
} from "@silvicom/shared";
import { AppCard as BaseCard } from "@silvicom/ui";
import { AppButton as BaseButton } from "@silvicom/ui";
import { AppInput as BaseInput } from "@silvicom/ui";
import { AppCheckbox as BaseCheckbox } from "@silvicom/ui";
import { AppDateField, AppFormField as FormField } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useDocumentsQuery, useQualificationRecordsQuery } from "@/composables/useCompliance";
import { useImportPspRecord } from "@/features/recruitment/usePspImport";
import PspOrderDrawer from "@/features/recruitment/PspOrderDrawer.vue";
import { useDriverQuery } from "@/composables/useDrivers";

/**
 * PSP records on the driver page — the ones we bought on the portal, filed rather than re-bought.
 *
 * ── WHY THIS LIVES IN RECRUITMENT ───────────────────────────────────────────────────────────────
 * It sits beside the employment history the PSP record corroborates, which is where the person
 * doing the screening already is. That is now the whole reason.
 *
 * It used to be a workaround, and the note is worth keeping for one release: the placement was
 * forced because the qualification section's write affordances gated on `canManageFleet`, which a
 * recruiter does not hold — so the entry point would have been invisible to the exact role
 * §391.53(a)(1) names as making the hiring decision. R0 deleted that boolean and those affordances
 * now ask `can("roster")`, and R7 moved this page off the driver record entirely. The placement
 * survived its own justification because it was independently right.
 *
 * ── WHAT THE TABLE SAYS, AND WHAT IT REFUSES TO SAY ─────────────────────────────────────────────
 * An imported PDF has been read by nobody, so there are no inspection or crash counts to show and
 * none are invented — the column says "not machine-read" rather than "0". Zero inspections is a
 * claim about a driver (D-PSP5); an absent count is not.
 */
const props = defineProps<{ driverId: string }>();
const driverId = computed(() => props.driverId);

const session = useSessionStore();
const toast = useToastStore();
const recordsQ = useQualificationRecordsQuery(driverId);
const subjectType = ref("driver");
/**
 * The report itself, not just the fact of it.
 *
 * A record was ordered on 2026-08-20 and the operator could not find the PDF: it was filed
 * correctly — bytes in storage, sha256 recorded, `qualification_records.document_id` pointing at it —
 * and this table simply never offered it. The only way to reach it was the Qualification tab, which
 * is the tab a recruiter does not open, and this is the panel whose entire subject is PSP records.
 *
 * It matters more here than elsewhere because the alternative is not "look somewhere else": §7's
 * `authCode` dies after 120 hours, so a report that cannot be found from the screen that bought it
 * is one somebody eventually re-buys at $10.
 */
const docsQ = useDocumentsQuery(subjectType, driverId);

/** Signed for minutes and re-signed on refetch — never stored, never rendered as a permanent link. */
const reportUrl = computed(() => {
  const m = new Map<string, string>();
  for (const d of docsQ.data.value ?? []) if (d.url) m.set(d.id, d.url);
  return m;
});
const driverQ = useDriverQuery(driverId);
const importRecord = useImportPspRecord();
const orderOpen = ref(false);

/**
 * The same intersection the API guard is built from, derived from the same two predicates rather
 * than listed: manage the Recruitment section AND be permitted to read investigation history. It
 * refuses exactly one role — the fleet_manager, who would otherwise be filing evidence into a class
 * they cannot open.
 */
const canFile = computed(() => {
  const role = session.role;
  if (!role) return false;
  return rolesThatManage("recruitment").includes(role) && canReadInvestigationHistory(role);
});

const rows = computed<QualificationRecordRow[]>(() =>
  (recordsQ.data.value ?? []).filter((r) => r.kind === "psp_report"),
);

const drawerOpen = ref(false);
const form = reactive({ obtainedOn: "", reference: "", note: "", attested: false });
const pdf = ref<File | null>(null);

function reset(): void {
  Object.assign(form, { obtainedOn: "", reference: "", note: "", attested: false });
  pdf.value = null;
}
watch(drawerOpen, (open) => {
  if (!open) reset();
});

const ready = computed(() => Boolean(pdf.value && form.obtainedOn && form.attested));

async function submit(): Promise<void> {
  if (!pdf.value) return;
  try {
    await importRecord.mutateAsync({
      driverId: driverId.value,
      file: pdf.value,
      obtainedOn: form.obtainedOn,
      reference: form.reference.trim() || null,
      note: form.note.trim() || null,
    });
    toast.success("PSP record filed", "It is in the driver's qualification file.");
    drawerOpen.value = false;
  } catch (e) {
    toast.error("Could not file the PSP record", e instanceof Error ? e.message : undefined);
  }
}

const columns: DataTableColumn[] = [
  { key: "occurred_on", label: "Obtained" },
  { key: "source", label: "Source" },
  { key: "findings", label: "Findings" },
  { key: "reference", label: "Reference" },
  { key: "report", label: "Report" },
];

/**
 * Ordered records carry P2's counted projection; imported ones carry nothing, and say so.
 *
 * The question asked is "does this row hold structured data", not "was it imported" — a record whose
 * source was never recorded answers no, which is the safe direction: rendering counts nothing
 * produced is worse than declining to render counts that exist.
 */
function findings(row: QualificationRecordRow): string {
  if (!hasStructuredPspData(row.detail)) return "Not machine-read — read the PDF";
  const inspections = row.detail.inspections;
  const crashes = row.detail.crashes;
  if (typeof inspections !== "number" || typeof crashes !== "number") return "—";
  return `${inspections} inspection${inspections === 1 ? "" : "s"} · ${crashes} crash${crashes === 1 ? "" : "es"}`;
}

/** Read from the row, never inferred from its shape (P9) — psp/provenance.ts says why. */
const sourceLabel = (row: QualificationRecordRow): string => PSP_SOURCE_LABELS[pspRecordSource(row.detail)];
const sourceTone = (row: QualificationRecordRow): string => {
  const source = pspRecordSource(row.detail);
  return source === "psp_api" ? "info" : source === "portal_import" ? "neutral" : "warning";
};
</script>

<template>
  <div class="space-y-6">
    <BaseCard>
      <div class="flex items-start justify-between gap-4">
        <div>
          <h3 class="text-sm font-semibold text-ink">PSP records</h3>
          <p class="mt-1 text-sm text-ink-muted">
            The FMCSA Pre-Employment Screening Program is voluntary — a file without one is still a
            lawful qualification file. A record bought on the PSP portal can be filed here; there is no way
            for us to fetch it, because the REST API has no endpoint that lists past transactions and
            a report can only be retrieved with the code from the request that bought it.
          </p>
        </div>
        <div v-if="canFile" class="flex shrink-0 items-center gap-3">
          <BaseButton @click="drawerOpen = true">Import a PSP record</BaseButton>
          <BaseButton variant="primary" @click="orderOpen = true">Order a PSP record</BaseButton>
        </div>
      </div>
    </BaseCard>

    <BaseCard padding="none">
      <DataTable
        :columns="columns"
        :rows="rows"
        row-key="id"
        :loading="recordsQ.isLoading.value"
        :error="recordsQ.isError.value ? (recordsQ.error.value?.message ?? 'Could not load the qualification file.') : null"
        :retrying="recordsQ.isFetching.value"
        empty-text="No PSP records on file. Import one you already bought, or order a fresh one once ordering is switched on."
      >
        <template #cell-occurred_on="{ row }">
          <span class="font-medium text-ink">{{ row.occurred_on }}</span>
        </template>
        <template #cell-source="{ row }">
          <span :class="[BADGE_BASE, toneClass(sourceTone(row))]">{{ sourceLabel(row) }}</span>
        </template>
        <template #cell-findings="{ row }">
          <span :class="hasStructuredPspData(row.detail) ? 'text-ink' : 'text-ink-muted'">
            {{ findings(row) }}
          </span>
        </template>
        <template #cell-reference="{ row }">
          <span v-if="row.reference" class="font-mono text-xs text-ink-secondary">{{ row.reference }}</span>
          <span v-else class="text-ink-muted">—</span>
        </template>
        <!--
          Three states, and the middle one is the reason this is not a one-liner. A document can be
          on file with no link this minute: `signDocumentRows` degrades a row to `url: null` rather
          than failing the page. Saying "Unavailable" is the honest word for that — rendering a dead
          link, or an em dash as though nothing had been bought, would both be lies about evidence.
        -->
        <template #cell-report="{ row }">
          <a
            v-if="row.document_id && reportUrl.get(row.document_id)"
            :href="reportUrl.get(row.document_id)"
            target="_blank"
            rel="noopener noreferrer"
            class="text-xs font-medium text-ink-secondary hover:text-link"
          >
            Download
          </a>
          <span v-else-if="row.document_id && docsQ.isLoading.value" class="text-xs text-ink-muted">Loading…</span>
          <span v-else-if="row.document_id" class="text-xs text-ink-muted">Unavailable</span>
          <span v-else class="text-ink-muted">—</span>
        </template>
      </DataTable>
    </BaseCard>

    <PspOrderDrawer
      :open="orderOpen"
      :driver-id="driverId"
      :driver-name="driverQ.data.value?.full_name ?? 'this driver'"
      @close="orderOpen = false"
    />

    <SlideOver :open="drawerOpen" size="lg" title="Import a PSP record" @close="drawerOpen = false">
      <div class="space-y-6">
        <p class="text-sm text-ink-muted">
          For a record already bought on the PSP portal. Nothing is ordered and nothing is charged.
          The PDF satisfies the qualification file; it carries no structured inspection data, so it
          does not feed the employment cross-check.
        </p>

        <div>
          <p class="text-sm font-medium text-ink">The report</p>
          <div class="mt-2">
            <FileDropzone
              accept=".pdf"
              :busy="importRecord.isPending.value"
              busy-label="Uploading…"
              :label="pdf ? pdf.name : 'Drag & drop the PSP PDF here'"
              hint="PDF only. Uploads straight to storage and is never publicly reachable."
              @files="pdf = $event[0] ?? null"
            />
          </div>
        </div>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField v-slot="{ id }" label="Obtained" hint="The date on the report itself.">
            <AppDateField :id="id" v-model="form.obtainedOn" />
          </FormField>
          <FormField v-slot="{ id }" label="Reference" hint="The portal's transaction number. Optional.">
            <BaseInput :id="id" v-model="form.reference" placeholder="Optional" />
          </FormField>
        </div>

        <FormField v-slot="{ id }" label="Note" hint="Where this came from, if it helps a later reader. Optional.">
          <BaseInput :id="id" v-model="form.note" placeholder="Optional" />
        </FormField>

        <BaseCheckbox v-model="form.attested">{{ PSP_IMPORT_CONSENT_ATTESTATION }}</BaseCheckbox>
      </div>

      <template #footer>
        <div class="flex items-center justify-end gap-3">
          <BaseButton variant="ghost" :disabled="importRecord.isPending.value" @click="drawerOpen = false">
            Cancel
          </BaseButton>
          <BaseButton
            variant="primary"
            :disabled="!ready || importRecord.isPending.value"
            @click="submit"
          >
            {{ importRecord.isPending.value ? "Filing…" : "File it" }}
          </BaseButton>
        </div>
      </template>
    </SlideOver>
  </div>
</template>
