<script setup lang="ts">
import { computed, ref, toRef } from "vue";
import {
  AppButton as BaseButton,
  AppCard as BaseCard,
  AppCombobox as ComboSelect,
  AppFormField as FormField,
  AppIcon,
} from "@silvicom/ui";
import { ArrowUpTrayIcon } from "@silvicom/ui/icons";
import {
  DOCUMENT_CONTENT_TYPES,
  ROADSIDE_DOCUMENT_KIND_TEXT,
  ROADSIDE_UPLOAD_KINDS,
  acceptFor,
  type DocumentRow,
  type RoadsideDocumentKind,
  type RoadsideUploadKind,
} from "@silvicom/shared";
import DocumentPreview from "@/components/DocumentPreview.vue";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import QueryState from "@/components/ui/QueryState.vue";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { formatDateTime } from "@/lib/format";
import { useInspectionDocumentsQuery, useUploadInspectionDocument } from "./useRoadsideInspections";

/**
 * The inspection's paper (INSPECTION-CHALLENGE-PLAN IC2, §6 "documents"): the ticket, the court's
 * result, the officer's copy. Filed against the inspection, not a violation — which violation a court
 * result answers is IC4's disposition record, citing the document (`roadsideDocumentsContract.ts`).
 *
 * Kept as uploaded (0146, append-only): there is no delete, and a wrong file is answered by filing the
 * right one, so the card says so before anyone looks for the button. Filing needs the safety section's
 * manage level, which the API checks; the drop zone only follows it. Viewing is `DocumentPreview`, the
 * one viewer, pointed at this inspection's own download route.
 */

const props = defineProps<{ inspectionId: string }>();
const id = toRef(props, "inspectionId");

const session = useSessionStore();
const canFile = computed(() => session.can("safety"));
const toast = useToastStore();

const { data: documents, isLoading, isError, error, isFetching, refetch } = useInspectionDocumentsQuery(id);
const upload = useUploadInspectionDocument(id);

const kindText = (kind: string) => ROADSIDE_DOCUMENT_KIND_TEXT[kind as RoadsideDocumentKind] ?? kind;
const kindOptions = ROADSIDE_UPLOAD_KINDS.map((k) => ({ value: k, label: ROADSIDE_DOCUMENT_KIND_TEXT[k] }));
/** What this upload takes, by mime and by every extension it is saved under (a `.jfif` is a JPEG). */
const uploadAccept = acceptFor(DOCUMENT_CONTENT_TYPES);

const dropped = ref<File | null>(null);
const kind = ref<RoadsideUploadKind | "">("");

async function file(): Promise<void> {
  const chosen = dropped.value;
  if (!chosen || !kind.value) return;
  try {
    await upload.mutateAsync({ kind: kind.value, file: chosen });
    toast.success("Document filed", `${ROADSIDE_DOCUMENT_KIND_TEXT[kind.value]} is on this inspection.`);
    dropped.value = null;
    kind.value = "";
  } catch (e) {
    toast.error("Could not file the document", e instanceof Error ? e.message : undefined);
  }
}

const viewing = ref<DocumentRow | null>(null);
</script>

<template>
  <BaseCard data-test="documents-card">
    <h2 class="text-sm font-semibold text-ink">Documents</h2>
    <p class="mt-1 text-sm text-ink-muted">
      The ticket, the court's result, or the officer's copy of the report. Each file is kept as uploaded; a wrong one is answered by filing the right one.
    </p>

    <div class="mt-4" data-test="documents-state">
      <QueryState
        compact
        :loading="isLoading && !documents"
        :error="isError ? error : null"
        :retrying="isFetching"
        loading-text="Loading the documents…"
        error-text="Could not load the documents."
        @retry="refetch()"
      >
        <p v-if="!documents?.length" class="text-sm text-ink-tertiary" data-test="documents-none">No documents filed for this inspection.</p>
        <ul v-else class="divide-y divide-edge text-sm" data-test="documents-list">
          <li v-for="d in documents" :key="d.id" class="flex flex-wrap items-center justify-between gap-2 py-2" data-test="document">
            <div>
              <p class="font-medium text-ink">{{ kindText(d.kind) }}</p>
              <p class="text-xs text-ink-muted">Filed {{ formatDateTime(d.createdAt) }}</p>
            </div>
            <BaseButton variant="link" data-test="document-view" @click="viewing = d">View</BaseButton>
          </li>
        </ul>
      </QueryState>
    </div>

    <div v-if="canFile" class="mt-5 space-y-4 border-t border-edge pt-5" data-test="documents-upload">
      <FileDropzone
        :accept="uploadAccept"
        :busy="upload.isPending.value"
        busy-label="Uploading…"
        :label="dropped ? dropped.name : 'Drag & drop the ticket or court paper here'"
        hint="PDF or photo."
        @files="dropped = $event[0] ?? null"
      />
      <div v-if="dropped" class="flex flex-wrap items-end gap-3">
        <FormField v-slot="{ id: fieldId }" label="What is it?" class="min-w-[16rem] flex-1" required>
          <ComboSelect :id="fieldId" v-model="kind" :options="kindOptions" placeholder="Choose…" />
        </FormField>
        <BaseButton variant="primary" :disabled="!kind || upload.isPending.value" data-test="documents-file" @click="file">
          <AppIcon :icon="ArrowUpTrayIcon" class="size-4" aria-hidden="true" />
          {{ upload.isPending.value ? "Uploading…" : "File it" }}
        </BaseButton>
      </div>
    </div>

    <DocumentPreview
      :open="viewing !== null"
      :label="viewing ? kindText(viewing.kind) : ''"
      :doc="viewing"
      :download-path="viewing ? `/api/roadside-inspections/${encodeURIComponent(inspectionId)}/documents/${viewing.id}/download` : null"
      @close="viewing = null"
    />
  </BaseCard>
</template>
