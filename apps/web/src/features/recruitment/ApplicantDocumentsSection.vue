<script setup lang="ts">
import { computed, ref } from "vue";
import {
  AppButton as BaseButton,
  AppCard as BaseCard,
  AppFormField as FormField,
  AppSelect,
  QueryState,
} from "@silvicom/ui";
import {
  APPLICANT_DOCUMENT_OFFICE_LABELS,
  APPLICANT_DOCUMENT_SLOTS,
  formatDisplayDate,
  type ApplicantDocument,
  type PromotedCaptureSlot,
} from "@silvicom/shared";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { pickImageFile } from "@/lib/filePicker";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useApplicantDocumentsQuery, useUploadApplicantDocument } from "@/features/recruitment/useApplicantDocuments";

/**
 * The applicant's documents on their record, and the office's upload (HIRING-WORKFLOW-AUDIT-2026-10-31
 * §3.5/§4.7, §9 P9).
 *
 * The audit found the office had no upload on the applicant record — `useUploadDocument` was mounted
 * only on the driver page, behind a route a recruiter cannot write. This section lists what the applicant
 * sent (still on the link, or filed) and what the office added, each row saying which, and files a new
 * paper for this driver through the recruitment door, by drag-and-drop or the phone's camera. "What is
 * it?" is the applicant's own list (`APPLICANT_DOCUMENT_SLOTS`), so both sides file the same kinds.
 *
 * ⚠ Q-WF4: an SSN card or a passport is listed for every reader; its picture is opened only by a role
 * the API signs it for. The API withholds the URL — this section only says so in words.
 */
const props = defineProps<{ driverId: string }>();

const session = useSessionStore();
const toast = useToastStore();
const documentsQ = useApplicantDocumentsQuery(computed(() => props.driverId));
const upload = useUploadApplicantDocument();

/** SP5: the org's own answer for the section the door answers to (`requireSection("recruitment")`). */
const canAdd = computed(() => session.can("recruitment"));

const SLOT_OPTIONS = APPLICANT_DOCUMENT_SLOTS.map((value) => ({ value, label: APPLICANT_DOCUMENT_OFFICE_LABELS[value] }));
const slot = ref<PromotedCaptureSlot | null>(null);

const labelOf = (d: ApplicantDocument): string =>
  d.slot ? (APPLICANT_DOCUMENT_OFFICE_LABELS[d.slot as PromotedCaptureSlot] ?? d.kind) : d.kind;
const isImage = (d: ApplicantDocument): boolean => d.contentType.startsWith("image/");

async function add(files: File[]): Promise<void> {
  const file = files[0];
  if (!file || !slot.value) return;
  try {
    await upload.mutateAsync({ driverId: props.driverId, slot: slot.value, file });
    toast.success("Document added", `${APPLICANT_DOCUMENT_OFFICE_LABELS[slot.value]} is on file.`);
    slot.value = null;
  } catch (e) {
    toast.error("Could not add the document", e instanceof Error ? e.message : "Try again.");
  }
}

/** A phone's camera, from the record itself — the office photographs a card the applicant brought in. */
async function photograph(): Promise<void> {
  const file = await pickImageFile("image/*", "environment");
  if (file) await add([file]);
}
</script>

<template>
  <BaseCard>
    <h3 class="text-sm font-semibold text-ink">Documents</h3>
    <p class="mt-1 max-w-2xl text-sm text-ink-muted">
      What the applicant sent from their link, and papers the office adds. Each is filed in the driver's file.
    </p>

    <div v-if="canAdd" class="mt-4 space-y-3" data-documents-add>
      <FormField v-slot="{ id }" label="What is it?">
        <AppSelect :id="id" v-model="slot" :options="SLOT_OPTIONS" placeholder="Choose the document" />
      </FormField>
      <template v-if="slot">
        <FileDropzone
          accept="image/*,application/pdf"
          label="Drag a photo or a PDF here, or choose one"
          :busy="upload.isPending.value"
          busy-label="Adding…"
          @files="add"
        />
        <BaseButton variant="secondary" :disabled="upload.isPending.value" @click="photograph">
          Take a photo
        </BaseButton>
      </template>
    </div>

    <div class="mt-4">
      <QueryState
        :loading="documentsQ.isLoading.value"
        :error="documentsQ.isError.value ? documentsQ.error.value : null"
        :retrying="documentsQ.isFetching.value"
        loading-text="Loading the documents…"
        error-text="Could not load this applicant's documents."
        compact
        @retry="documentsQ.refetch()"
      >
        <p v-if="(documentsQ.data.value ?? []).length === 0" class="text-sm text-ink-muted">
          No documents yet. The applicant can send them from their link, or add one above.
        </p>
        <ul v-else class="divide-y divide-edge">
          <li
            v-for="d in documentsQ.data.value"
            :key="d.id"
            class="flex flex-wrap items-center gap-3 py-3"
            :data-document="d.id"
          >
            <img
              v-if="d.url && isImage(d)"
              :src="d.url"
              :alt="labelOf(d)"
              class="h-12 w-16 shrink-0 rounded-detail object-cover ring-1 ring-inset ring-edge"
            />
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-ink">{{ labelOf(d) }}</p>
              <p class="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                <span :class="[BADGE_BASE, toneClass(d.source === 'applicant' ? 'info' : 'neutral')]">
                  {{ d.source === "applicant" ? "Sent by applicant" : `Added by ${d.addedBy ?? "the office"}` }}
                </span>
                <span>{{ formatDisplayDate(d.at) }}</span>
                <span v-if="d.contentType === 'application/pdf'">PDF</span>
                <span v-if="d.staged">Filed when the applicant finishes</span>
              </p>
            </div>
            <a
              v-if="d.url"
              :href="d.url"
              target="_blank"
              rel="noopener noreferrer"
              class="text-sm font-medium text-link hover:text-link-hover"
            >
              Open
            </a>
            <p v-else-if="d.imageWithheld" class="text-xs text-ink-muted" data-image-withheld>
              Only an administrator or a safety manager can open this.
            </p>
          </li>
        </ul>
      </QueryState>
    </div>
  </BaseCard>
</template>
