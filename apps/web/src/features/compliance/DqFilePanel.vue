<script setup lang="ts">
import { computed, ref } from "vue";
import type { DqFileItem, DocumentKind } from "@fuelguard/shared";
import { buildDqFile, moduleEnabled } from "@fuelguard/shared";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import FormField from "@/components/ui/FormField.vue";
import ComboSelect from "@/components/ui/ComboSelect.vue";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useToastStore } from "@/stores/toast";
import { useModulesQuery } from "@/composables/useModules";
import {
  useCertificationsQuery,
  useDocumentsQuery,
  useQualificationRecordsQuery,
  useUploadDocument,
} from "@/composables/useCompliance";

/**
 * One driver's qualification file — §391.51 as a checklist (DQF plan, DQ2).
 *
 * A section inside the existing drawer, not a page: the roster answers "who is short of what", this
 * answers "what is missing for this person and where is the paper".
 *
 * The checklist itself is `buildDqFile` in @fuelguard/shared — pure, unit-tested, and the same
 * function an audit export will render from. Nothing about which item is due lives here.
 */
const props = defineProps<{ driverId: string; canManage: boolean }>();
const toast = useToastStore();

const driverIdRef = computed<string | null>(() => props.driverId);
const subjectType = ref("driver");

const certsQ = useCertificationsQuery(subjectType, driverIdRef);
const recordsQ = useQualificationRecordsQuery(driverIdRef);
const docsQ = useDocumentsQuery(subjectType, driverIdRef);
const modules = useModulesQuery();
const upload = useUploadDocument();

const loading = computed(() => certsQ.isLoading.value || recordsQ.isLoading.value || docsQ.isLoading.value);
const retrying = computed(() => certsQ.isFetching.value || recordsQ.isFetching.value || docsQ.isFetching.value);
/** A compliance checklist that fails to load must say so. Rendering an empty file would claim, in
 *  writing, that a driver holds no CDL. */
const errorMessage = computed<string | null>(() => {
  const failed = [certsQ, recordsQ, docsQ].find((q) => q.isError.value);
  return failed ? (failed.error.value?.message ?? "Could not load the qualification file.") : null;
});
function retry(): void {
  void certsQ.refetch();
  void recordsQ.refetch();
  void docsQ.refetch();
}

const today = new Date().toISOString().slice(0, 10);

const file = computed(() =>
  buildDqFile({
    today,
    includeHazmat: moduleEnabled(modules.data.value ?? null, "hazmatguard"),
    certs: (certsQ.data.value ?? []).map((c) => ({
      kind: c.kind,
      qualifier: c.qualifier,
      trainingType: c.training_type,
      issuedAt: c.issued_at,
      expiresAt: c.expires_at,
      documentId: c.document_id,
    })),
    records: (recordsQ.data.value ?? []).map((r) => ({
      kind: r.kind,
      occurredOn: r.occurred_on,
      coversUntil: r.covers_until,
      documentId: r.document_id,
    })),
    documents: (docsQ.data.value ?? []).map((d) => ({ id: d.id, kind: d.kind })),
  }),
);

const STATE_TONE: Record<DqFileItem["state"], string> = {
  current: "success",
  expiring: "warning",
  expired: "danger",
  missing: "neutral",
};
/** Lowercase: BADGE_BASE capitalises, and the source string stays sentence case like every other. */
const STATE_LABEL: Record<DqFileItem["state"], string> = {
  current: "on file",
  expiring: "due soon",
  expired: "expired",
  missing: "missing",
};

interface DqRow {
  key: string;
  label: string;
  citation: string;
  retention: string;
  state: DqFileItem["state"];
  goodUntil: string | null;
  expiryUnknown: boolean;
  documentId: string | null;
  documentUrl: string | null;
}

const urlById = computed(() => {
  const m = new Map<string, string>();
  for (const d of docsQ.data.value ?? []) if (d.url) m.set(d.id, d.url);
  return m;
});

const rows = computed<DqRow[]>(() =>
  file.value.items.map((i) => ({
    key: i.spec.key,
    label: i.spec.label,
    citation: i.spec.citation,
    retention: i.spec.retention,
    state: i.state,
    goodUntil: i.goodUntil,
    expiryUnknown: i.expiryUnknown,
    documentId: i.documentId,
    documentUrl: i.documentId ? (urlById.value.get(i.documentId) ?? null) : null,
  })),
);

const columns: DataTableColumn[] = [
  { key: "label", label: "Requirement", headerClass: "min-w-[18rem]", cellClass: "font-medium text-ink" },
  { key: "state", label: "Status", headerClass: "w-32" },
  { key: "goodUntil", label: "Good until", headerClass: "w-32", cellClass: "text-ink-secondary" },
  { key: "documentId", label: "Scan", headerClass: "w-24" },
];

/** Requirements a scan can be filed against, missing ones first — the reason the drawer is open. */
const attachOptions = computed(() =>
  [...file.value.items]
    .sort((a, b) => Number(Boolean(a.documentId)) - Number(Boolean(b.documentId)))
    .map((i) => ({ value: i.spec.key, label: i.spec.label })),
);
const attachKey = ref("");

async function onFiles(files: File[]): Promise<void> {
  const chosen = files[0];
  if (!chosen) return;
  const spec = file.value.items.find((i) => i.spec.key === attachKey.value)?.spec;
  if (!spec) {
    toast.error("Choose a requirement", "Pick what this document proves before uploading it.");
    return;
  }
  try {
    await upload.mutateAsync({
      subjectType: "driver",
      subjectId: props.driverId,
      // Filed under the requirement's own kind, so the checklist finds it again even when the
      // certification row that will cite it does not exist yet.
      kind: spec.evidenceKinds[0] as DocumentKind,
      file: chosen,
    });
    toast.success("Document filed", spec.label);
    attachKey.value = "";
  } catch (e) {
    toast.error("Could not file the document", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-6">
    <section>
      <h3 class="text-sm font-semibold text-ink">Qualification file</h3>
      <p class="mt-1 text-sm text-ink-muted">
        49 CFR §391.51. Retention rules are shown per requirement and are never applied automatically.
      </p>

      <div class="mt-3">
        <DataTable
          :columns="columns"
          :rows="rows"
          row-key="key"
          :loading="loading"
          :error="errorMessage"
          :retrying="retrying"
          :sticky-header="false"
          empty-text="Nothing on file yet. Attach a document below, or add a certification."
          @retry="retry"
        >
          <template #cell-label="{ row }">
            <span class="text-ink">{{ row.label }}</span>
            <span class="mt-0.5 block text-xs text-ink-subtle" :title="row.retention">{{ row.citation }}</span>
          </template>

          <template #cell-state="{ row }">
            <span :class="[BADGE_BASE, toneClass(STATE_TONE[row.state])]">{{ STATE_LABEL[row.state] }}</span>
            <span v-if="row.expiryUnknown" class="mt-0.5 block text-xs text-warning-700">No expiry recorded.</span>
          </template>

          <template #cell-goodUntil="{ row }">
            <span v-if="row.goodUntil">{{ row.goodUntil }}</span>
            <span v-else class="text-ink-subtle">—</span>
          </template>

          <template #cell-documentId="{ row }">
            <a
              v-if="row.documentUrl"
              :href="row.documentUrl"
              target="_blank"
              rel="noopener"
              class="font-medium text-brand-600 hover:text-brand-500"
            >View</a>
            <span v-else class="text-ink-subtle">—</span>
          </template>
        </DataTable>
      </div>
    </section>

    <section v-if="canManage" class="border-t border-edge pt-5">
      <h3 class="text-sm font-semibold text-ink">Attach a document</h3>
      <div class="mt-3 space-y-4">
        <FormField v-slot="{ id }" label="Requirement" hint="What this scan proves. Items without a scan are listed first.">
          <ComboSelect :id="id" v-model="attachKey" :options="attachOptions" placeholder="Choose a requirement…" />
        </FormField>
        <FileDropzone
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic"
          :disabled="!attachKey"
          :busy="upload.isPending.value"
          busy-label="Uploading…"
          label="Drag & drop a scan here"
          hint="PDF or photo. The file uploads straight to storage and is never publicly reachable."
          @files="onFiles"
        />
      </div>
    </section>
  </div>
</template>
