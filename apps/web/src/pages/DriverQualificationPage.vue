<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, RouterLink } from "vue-router";
import {
  buildDqFile,
  dqAttention,
  dqGroups,
  moduleEnabled,
  type DqFileItem,
  type DqItemState,
} from "@fuelguard/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import ComboSelect from "@/components/ui/ComboSelect.vue";
import FormField from "@/components/ui/FormField.vue";
import StatusBadge from "@/components/StatusBadge.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useModulesQuery } from "@/composables/useModules";
import { useDriverQuery } from "@/composables/useDrivers";
import {
  useCertificationsQuery,
  useDocumentsQuery,
  useQualificationRecordsQuery,
  useUploadDocument,
} from "@/composables/useCompliance";
import RequirementDrawer from "@/features/compliance/RequirementDrawer.vue";
import CertificationHistory from "@/features/compliance/CertificationHistory.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import { useExportDocument, useRequestBinder } from "@/composables/useDqExports";

/**
 * One driver's §391.51 file (DQ redesign, D-DQ7).
 *
 * A page, not a drawer: eighteen requirements, their documents and their history is a workspace. Not
 * a new nav section — the detail view of a list that already exists, the same move Loads made.
 *
 * The page is short when the file is clean and long when it is not (D-DQ8): complete groups collapse
 * to a single line, and the table shows what needs attention until you ask for everything.
 */
const route = useRoute();
const session = useSessionStore();
const toast = useToastStore();
const driverId = computed(() => String(route.params.id ?? ""));

const driverQ = useDriverQuery(driverId);
const subjectType = ref("driver");
const certsQ = useCertificationsQuery(subjectType, driverId);
const recordsQ = useQualificationRecordsQuery(driverId);
const docsQ = useDocumentsQuery(subjectType, driverId);
const modules = useModulesQuery();
const upload = useUploadDocument();

const loading = computed(
  () => certsQ.isLoading.value || recordsQ.isLoading.value || docsQ.isLoading.value,
);
const retrying = computed(
  () => certsQ.isFetching.value || recordsQ.isFetching.value || docsQ.isFetching.value,
);
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

const groups = computed(() => dqGroups(file.value));
const attentionKeys = computed(() => new Set(dqAttention(file.value, today).map((a) => a.key)));

const STATE_TONE: Record<DqItemState, string> = {
  current: "success",
  expiring: "warning",
  expired: "danger",
  missing: "neutral",
};
const STATE_LABEL: Record<DqItemState, string> = {
  current: "on file",
  expiring: "due soon",
  expired: "expired",
  missing: "missing",
};
const GROUP_LINE: Record<DqItemState, string> = {
  current: "complete",
  expiring: "due soon",
  expired: "expired",
  missing: "incomplete",
};

const showAll = ref(false);

const urlById = computed(() => {
  const m = new Map<string, string>();
  for (const d of docsQ.data.value ?? []) if (d.url) m.set(d.id, d.url);
  return m;
});

interface Row {
  key: string;
  label: string;
  citation: string;
  group: string;
  state: DqItemState;
  goodUntil: string | null;
  expiryUnknown: boolean;
  documentUrl: string | null;
}
const toRow = (i: DqFileItem): Row => ({
  key: i.spec.key,
  label: i.spec.label,
  citation: i.spec.citation,
  group: i.spec.group,
  state: i.state,
  goodUntil: i.goodUntil,
  expiryUnknown: i.expiryUnknown,
  documentUrl: i.documentId ? (urlById.value.get(i.documentId) ?? null) : null,
});

const rows = computed<Row[]>(() =>
  file.value.items.filter((i) => showAll.value || attentionKeys.value.has(i.spec.key)).map(toRow),
);

const columns: DataTableColumn[] = [
  {
    key: "label",
    label: "Requirement",
    headerClass: "min-w-[18rem]",
    cellClass: "font-medium text-ink",
  },
  { key: "state", label: "Status", headerClass: "w-32" },
  { key: "goodUntil", label: "Good until", headerClass: "w-32", cellClass: "text-ink-secondary" },
  { key: "documentUrl", label: "Scan", headerClass: "w-24" },
];

// ── releasing a document (D-BD10) ─────────────────────────────────────────────────────
//
// Internal sharing is ACCESS, not attachment: dispatch can already open this page, so "dispatch
// needs the CDL" is answered by a link. This is the outward case — a broker or shipper who has no
// login — and what makes it safe to send is the stamp: driver, requirement, validity, who released
// it, so a page that surfaces in somebody's inbox six months later can still be traced.
const exportDoc = useExportDocument();
const requestBinder = useRequestBinder();
const releasing = ref<string | null>(null);

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

async function release(row: Row): Promise<void> {
  releasing.value = row.key;
  try {
    await exportDoc.mutateAsync({
      driverId: driverId.value,
      requirementKey: row.key,
      asAt: null,
      filename: `${slug(driverQ.data.value?.full_name ?? "driver")}-${slug(row.label)}-${today}.pdf`,
    });
    toast.success("Document released", "It is stamped with today's date and this driver's name.");
  } catch (e) {
    toast.error("Could not release the document", e instanceof Error ? e.message : undefined);
  }
  releasing.value = null;
}

async function exportWholeFile(): Promise<void> {
  try {
    await requestBinder.mutateAsync({ driverIds: [driverId.value], asAt: null });
    toast.success(
      "Building the file",
      "It appears under Exports on the qualification page shortly.",
    );
  } catch (e) {
    toast.error("Could not start the export", e instanceof Error ? e.message : undefined);
  }
}

// ── the drawer ────────────────────────────────────────────────────────────────────────
const openKey = ref<string | null>(null);

// ── drop first, classify after (D-DQ10) ──────────────────────────────────────────────
const dropped = ref<File | null>(null);
const dropKind = ref("");
const dropOptions = computed(() =>
  file.value.items.map((i) => ({ value: i.spec.key, label: i.spec.label })),
);

async function fileDropped(): Promise<void> {
  const chosen = dropped.value;
  const spec = file.value.items.find((i) => i.spec.key === dropKind.value)?.spec;
  if (!chosen || !spec) return;
  try {
    await upload.mutateAsync({
      subjectType: "driver",
      subjectId: driverId.value,
      kind: spec.evidenceKinds[0] as Parameters<typeof upload.mutateAsync>[0]["kind"],
      file: chosen,
    });
    toast.success("Document filed", spec.label);
    dropped.value = null;
    dropKind.value = "";
  } catch (e) {
    toast.error("Could not file the document", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      :description="`49 CFR §391.51. ${driverQ.data.value?.full_name ?? 'This driver'}'s qualification file.`"
    >
      <template #actions>
        <BaseButton
          v-if="session.canManage"
          variant="ghost"
          :disabled="requestBinder.isPending.value"
          @click="exportWholeFile"
        >
          {{ requestBinder.isPending.value ? "Building…" : "Export this file" }}
        </BaseButton>
        <RouterLink to="/compliance">
          <BaseButton variant="ghost">Back to Driver Qualification</BaseButton>
        </RouterLink>
      </template>
    </PageHeader>

    <!-- The summary strip: a complete group is one green line, so a clean file reads in a glance. -->
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <BaseCard v-for="g in groups" :key="g.group" padding="sm">
        <p class="text-sm font-medium text-ink">{{ g.label }}</p>
        <p class="mt-2">
          <span :class="[BADGE_BASE, toneClass(STATE_TONE[g.state])]">{{
            GROUP_LINE[g.state]
          }}</span>
        </p>
        <p v-if="g.state !== 'current'" class="mt-2 text-xs text-ink-muted">
          {{ g.counts.expired }} expired · {{ g.counts.missing }} missing ·
          {{ g.counts.expiring }} due soon
        </p>
      </BaseCard>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-ink-secondary">
        <span v-if="driverQ.data.value">
          <StatusBadge :status="driverQ.data.value.status" />
        </span>
        <span class="ml-2"> {{ rows.length }} of {{ file.items.length }} requirements shown </span>
      </p>
      <BaseButton variant="ghost" size="sm" @click="showAll = !showAll">
        {{
          showAll ? "Show only what needs attention" : `Show all ${file.items.length} requirements`
        }}
      </BaseButton>
    </div>

    <DataTable
      :columns="columns"
      :rows="rows"
      row-key="key"
      :loading="loading"
      :error="errorMessage"
      :retrying="retrying"
      :empty-text="
        showAll
          ? 'Nothing on file yet. Drop a document below to start.'
          : 'Nothing needs attention. This file is complete.'
      "
      @retry="retry"
    >
      <template #cell-label="{ row }">
        <span class="text-ink">{{ row.label }}</span>
        <span class="mt-0.5 block text-xs text-ink-subtle">{{ row.citation }}</span>
      </template>
      <template #cell-state="{ row }">
        <span :class="[BADGE_BASE, toneClass(STATE_TONE[row.state])]">{{
          STATE_LABEL[row.state]
        }}</span>
        <span v-if="row.expiryUnknown" class="mt-0.5 block text-xs text-warning-700"
          >No expiry recorded.</span
        >
      </template>
      <template #cell-goodUntil="{ row }">
        <span v-if="row.goodUntil">{{ row.goodUntil }}</span>
        <span v-else class="text-ink-subtle">—</span>
      </template>
      <template #cell-documentUrl="{ row }">
        <a
          v-if="row.documentUrl"
          :href="row.documentUrl"
          target="_blank"
          rel="noopener"
          class="font-medium text-brand-600 hover:text-brand-500"
          >View</a
        >
        <span v-else class="text-ink-subtle">—</span>
      </template>
      <template #actions="{ row }">
        <div v-if="session.canManage" class="flex items-center justify-end gap-1">
          <BaseButton variant="ghost" size="sm" @click.stop="openKey = row.key">
            {{ row.state === "missing" ? "Record" : "Renew" }}
          </BaseButton>
          <KebabMenu v-if="row.documentUrl">
            <button
              type="button"
              class="kebab-item"
              :disabled="releasing === row.key"
              @click="release(row)"
            >
              {{ releasing === row.key ? "Preparing…" : "Release stamped copy…" }}
            </button>
          </KebabMenu>
        </div>
      </template>
    </DataTable>

    <BaseCard v-if="session.canManage">
      <h3 class="text-sm font-semibold text-ink">Drop a document</h3>
      <p class="mt-1 text-sm text-ink-muted">
        The scan usually arrives before the data entry. Drop it here and say what it proves.
      </p>
      <div class="mt-3 space-y-4">
        <FileDropzone
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic"
          :busy="upload.isPending.value"
          busy-label="Uploading…"
          :label="dropped ? dropped.name : 'Drag & drop a scan here'"
          hint="PDF or photo."
          @files="dropped = $event[0] ?? null"
        />
        <div v-if="dropped" class="flex flex-wrap items-end gap-3">
          <FormField v-slot="{ id }" label="What does it prove?" class="min-w-[16rem] flex-1">
            <ComboSelect
              :id="id"
              v-model="dropKind"
              :options="dropOptions"
              placeholder="Choose a requirement…"
            />
          </FormField>
          <BaseButton
            variant="primary"
            :disabled="!dropKind || upload.isPending.value"
            @click="fileDropped"
          >
            {{ upload.isPending.value ? "Uploading…" : "File it" }}
          </BaseButton>
        </div>
      </div>
    </BaseCard>

    <CertificationHistory :driver-id="driverId" />

    <RequirementDrawer
      :open="openKey !== null"
      :driver-id="driverId"
      :item-key="openKey"
      @close="openKey = null"
    />
  </div>
</template>
