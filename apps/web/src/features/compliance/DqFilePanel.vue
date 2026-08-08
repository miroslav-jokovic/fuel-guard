<script setup lang="ts">
import { computed, ref } from "vue";
import type { DqFileItem, DocumentKind } from "@fuelguard/shared";
import { buildDqFile, moduleEnabled } from "@fuelguard/shared";
import BaseButton from "@/components/ui/BaseButton.vue";
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
 * A section inside the existing drawer, not a page. The roster answers "who is short of what"; this
 * answers "what exactly is missing for this person, and where is the paper". Adding a route for it
 * would put a third surface between a manager and a medical card scan.
 *
 * The checklist itself is `buildDqFile` in @fuelguard/shared: pure, unit-tested, and the same
 * function the API will render an audit export from. Nothing about which item is due lives here.
 */
const props = defineProps<{ driverId: string; canManage: boolean }>();
const toast = useToastStore();

const driverIdRef = computed<string | null>(() => props.driverId);
const subjectType = ref("driver");

const { data: certs, isLoading: certsLoading } = useCertificationsQuery(subjectType, driverIdRef);
const { data: records, isLoading: recordsLoading } = useQualificationRecordsQuery(driverIdRef);
const { data: documents, isLoading: docsLoading } = useDocumentsQuery(subjectType, driverIdRef);
const modules = useModulesQuery();
const upload = useUploadDocument();

const loading = computed(() => certsLoading.value || recordsLoading.value || docsLoading.value);
const today = new Date().toISOString().slice(0, 10);

const file = computed(() =>
  buildDqFile({
    today,
    includeHazmat: moduleEnabled(modules.data.value ?? null, "hazmatguard"),
    certs: (certs.value ?? []).map((c) => ({
      kind: c.kind,
      qualifier: c.qualifier,
      trainingType: c.training_type,
      issuedAt: c.issued_at,
      expiresAt: c.expires_at,
      documentId: c.document_id,
    })),
    records: (records.value ?? []).map((r) => ({
      kind: r.kind,
      occurredOn: r.occurred_on,
      coversUntil: r.covers_until,
      documentId: r.document_id,
    })),
    documents: (documents.value ?? []).map((d) => ({ id: d.id, kind: d.kind })),
  }),
);

/** Matches CertManager's vocabulary — expiring is amber, not red: a warning is not a violation. */
const STATE_CLASS: Record<DqFileItem["state"], string> = {
  current: "text-success-600",
  expiring: "text-warning-600",
  expired: "text-danger-600",
  missing: "text-ink-muted",
};
const STATE_LABEL: Record<DqFileItem["state"], string> = {
  current: "on file",
  expiring: "due soon",
  expired: "expired",
  missing: "missing",
};

const urlById = computed(() => {
  const m = new Map<string, string>();
  for (const d of documents.value ?? []) if (d.url) m.set(d.id, d.url);
  return m;
});

const fileInput = ref<HTMLInputElement | null>(null);
const pendingKind = ref<DocumentKind | null>(null);
const uploadingKey = ref<string | null>(null);

function chooseFile(item: DqFileItem) {
  // The document is filed under the item's own kind, so the checklist can find it again without
  // depending on a certification row existing first — a scan may arrive before the record does.
  pendingKind.value = item.spec.evidenceKinds[0] as DocumentKind;
  uploadingKey.value = item.spec.key;
  fileInput.value?.click();
}

async function onFileChosen(event: Event) {
  const input = event.target as HTMLInputElement;
  const chosen = input.files?.[0];
  const kind = pendingKind.value;
  input.value = ""; // let the same file be re-chosen after a failure
  if (!chosen || !kind) { uploadingKey.value = null; return; }
  try {
    await upload.mutateAsync({ subjectType: "driver", subjectId: props.driverId, kind, file: chosen });
    toast.success("Document filed", chosen.name);
  } catch (e) {
    toast.error("Upload failed", e instanceof Error ? e.message : "Could not file the document.");
  } finally {
    uploadingKey.value = null;
    pendingKind.value = null;
  }
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h3 class="text-sm font-semibold text-ink">Driver qualification file</h3>
      <p class="mt-1 text-sm text-ink-muted">
        49 CFR §391.51. Retention rules are shown per item and are never applied automatically.
      </p>

      <p v-if="loading" class="mt-3 text-sm text-ink-muted">Loading…</p>

      <template v-else>
        <p v-if="file.state === 'not_started'" class="mt-3 text-sm text-ink-secondary">
          Nothing has been filed for this driver yet. Add a certification below, or attach a scan to
          any row to start the file.
        </p>
        <p v-else class="mt-3 text-sm text-ink-secondary">
          {{ file.counts.current }} on file · {{ file.counts.expiring }} due soon ·
          {{ file.counts.expired }} expired · {{ file.counts.missing }} missing
        </p>

        <table class="mt-3 w-full text-sm">
          <thead class="text-left text-xs uppercase tracking-wide text-ink-subtle">
            <tr>
              <th class="py-1 pr-3 font-medium">Requirement</th>
              <th class="py-1 pr-3 font-medium">Status</th>
              <th class="py-1 pr-3 font-medium">Good until</th>
              <th class="py-1 font-medium">Scan</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in file.items" :key="i.spec.key" class="border-t border-edge-subtle align-top">
              <td class="py-1.5 pr-3">
                <span class="text-ink">{{ i.spec.label }}</span>
                <span class="block text-xs text-ink-subtle" :title="i.spec.retention">{{ i.spec.citation }}</span>
              </td>
              <td class="py-1.5 pr-3">
                <span :class="STATE_CLASS[i.state]">{{ STATE_LABEL[i.state] }}</span>
                <span v-if="i.expiryUnknown" class="block text-xs text-warning-600">no expiry recorded</span>
              </td>
              <td class="py-1.5 pr-3 text-ink-secondary">{{ i.goodUntil ?? "—" }}</td>
              <td class="py-1.5">
                <a
                  v-if="i.documentId && urlById.get(i.documentId)"
                  :href="urlById.get(i.documentId)"
                  target="_blank"
                  rel="noopener"
                  class="text-brand-600 hover:text-brand-500"
                >View</a>
                <BaseButton
                  v-else-if="canManage"
                  variant="ghost"
                  size="sm"
                  :disabled="upload.isPending.value"
                  @click="chooseFile(i)"
                >{{ uploadingKey === i.spec.key ? "Uploading…" : "Attach" }}</BaseButton>
                <span v-else class="text-ink-subtle">—</span>
              </td>
            </tr>
          </tbody>
        </table>

        <input
          ref="fileInput"
          type="file"
          class="hidden"
          accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
          @change="onFileChosen"
        />
      </template>
    </div>
  </div>
</template>
