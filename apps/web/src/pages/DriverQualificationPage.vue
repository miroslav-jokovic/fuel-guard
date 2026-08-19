<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { AppIcon } from "@fuelguard/ui";
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ClipboardDocumentCheckIcon,
  EyeIcon,
} from "@fuelguard/ui/icons";
import {
  buildDqFile,
  DQ_GROUP_LABELS,
  dqAttention,
  dqCapturableSpecs,
  dqGroups,
  isRestrictedQualificationKind,
  moduleEnabled,
  type DqGroup,
  type DqFileItem,
  type DqItemState,
} from "@fuelguard/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import { AppCard as BaseCard } from "@fuelguard/ui";
import { AppButton as BaseButton } from "@fuelguard/ui";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
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
} from "@/composables/useCompliance";
import DocumentDropCard from "@/features/compliance/DocumentDropCard.vue";
import RequirementDrawer from "@/features/compliance/RequirementDrawer.vue";
import CertificationHistory from "@/features/compliance/CertificationHistory.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import { formatDate } from "@/lib/format";
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

const loading = computed(
  () =>
    driverQ.isLoading.value ||
    certsQ.isLoading.value ||
    recordsQ.isLoading.value ||
    docsQ.isLoading.value ||
    modules.isLoading.value,
);
const retrying = computed(
  () =>
    driverQ.isFetching.value ||
    certsQ.isFetching.value ||
    recordsQ.isFetching.value ||
    docsQ.isFetching.value ||
    modules.isFetching.value,
);
const errorMessage = computed<string | null>(() => {
  const failed = [driverQ, certsQ, recordsQ, docsQ, modules].find((q) => q.isError.value);
  return failed ? (failed.error.value?.message ?? "Could not load the qualification file.") : null;
});
function retry(): void {
  void driverQ.refetch();
  void certsQ.refetch();
  void recordsQ.refetch();
  void docsQ.refetch();
  void modules.refetch();
}

const today = new Date().toISOString().slice(0, 10);

const file = computed(() =>
  buildDqFile({
    today,
    includeHazmat: moduleEnabled(modules.data.value ?? null, "hazmatguard"),
    // §391.51(b)(8) applies to non-CDL drivers only (D8) — same derivation the overview uses,
    // so the fleet queue and this page cannot disagree about the registry note.
    hasCdl: Boolean(driverQ.data.value?.cdl_number),
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

const docById = computed(() => {
  const m = new Map<string, { url: string; isImage: boolean }>();
  for (const d of docsQ.data.value ?? [])
    if (d.url) m.set(d.id, { url: d.url, isImage: d.contentType.startsWith("image/") });
  return m;
});

interface Row {
  key: string;
  label: string;
  group: DqGroup;
  state: DqItemState;
  evidenceDate: string | null;
  goodUntil: string | null;
  expiryUnknown: boolean;
  documentUrl: string | null;
  /** True when the scan is a photo the cell can show a thumbnail of (PDFs get the icon link). */
  documentIsImage: boolean;
  /** §382.401/§391.53 kinds (Phase G, D-DQ15): the STATE stays visible to every fleet role, but the
   *  evidence and the capture affordances belong to admin + safety_manager. The API filters the
   *  records/documents anyway — this flag is what replaces the dead affordance with an explanation. */
  restricted: boolean;
  /** Tracked-not-required (D8): the item only renders because evidence exists; label it as such. */
  advisory: boolean;
}
const toRow = (i: DqFileItem): Row => {
  const doc = i.documentId ? docById.value.get(i.documentId) : undefined;
  return {
    key: i.spec.key,
    label: i.spec.label,
    group: i.spec.group,
    state: i.state,
    evidenceDate: i.evidenceDate,
    goodUntil: i.goodUntil,
    expiryUnknown: i.expiryUnknown,
    documentUrl: doc?.url ?? null,
    documentIsImage: doc?.isImage ?? false,
    restricted: i.spec.evidenceKinds.some(isRestrictedQualificationKind),
    advisory: i.spec.advisory === true,
  };
};

const rows = computed<Row[]>(() =>
  file.value.items.filter((i) => showAll.value || attentionKeys.value.has(i.spec.key)).map(toRow),
);
const requirementSearch = ref("");
const requirementGroup = ref("");
const requirementGroupOptions = computed(() => [
  { value: "", label: "All groups" },
  ...Object.entries(DQ_GROUP_LABELS).map(([value, label]) => ({ value, label: String(label) })),
]);
const filteredRows = computed(() => {
  const term = requirementSearch.value.trim().toLowerCase();
  return rows.value.filter((row) => {
    if (requirementGroup.value && row.group !== requirementGroup.value) return false;
    return !term || row.label.toLowerCase().includes(term);
  });
});
const hasRequirementFilter = computed(
  () => Boolean(requirementSearch.value.trim() || requirementGroup.value),
);

const columns: DataTableColumn[] = [
  {
    key: "label",
    label: "Requirement",
    headerClass: "min-w-[18rem]",
    cellClass: "font-medium text-ink",
  },
  { key: "state", label: "Status", headerClass: "w-32" },
  {
    key: "evidenceDate",
    label: "Evidence date",
    headerClass: "w-36",
    cellClass: "text-ink-secondary",
  },
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
const presetDoc = ref<{ id: string; name: string } | null>(null);
function closeDrawer(): void {
  openKey.value = null;
  presetDoc.value = null;
}

// ── drop first, classify after (D-DQ10) ──────────────────────────────────────────────
// From dqCapturableSpecs, not file.items: an advisory item (ELDT) is absent from the checklist until
// evidence exists, and this list is where that first evidence comes from (D8). Restricted
// requirements (Phase G, D-DQ15) stay absent for roles that cannot record them — the API would
// refuse the record anyway; the option must not offer a dead end.
const dropItems = computed(() =>
  dqCapturableSpecs({
    includeHazmat: moduleEnabled(modules.data.value ?? null, "hazmatguard"),
    hasCdl: Boolean(driverQ.data.value?.cdl_number),
  })
    .filter(
      (spec) =>
        session.restrictedAccess || !spec.evidenceKinds.some(isRestrictedQualificationKind),
    )
    .map((spec) => ({
      key: spec.key,
      label: spec.label,
      // Every catalogue item names at least one evidence kind; the fallback only satisfies the index check.
      evidenceKind: spec.evidenceKinds[0] ?? "other",
    })),
);

/**
 * Filing the scan is half the job: the requirement only counts as on file once its dates are
 * recorded (buildDqFile reads certifications and records, not the document registry). The old flow
 * stopped after the upload, so the row stayed "missing" and the upload looked broken. Now the
 * requirement drawer opens with the scan already attached, asking only for the dates.
 */
function onFiled(payload: { documentId: string; name: string; key: string }): void {
  presetDoc.value = { id: payload.documentId, name: payload.name };
  openKey.value = payload.key;
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Qualification file and supporting records for this driver.">
      <template #actions>
        <BaseButton
          v-if="session.canManage"
          variant="ghost"
          :disabled="requestBinder.isPending.value"
          @click="exportWholeFile"
        >
          <AppIcon :icon="ArrowDownTrayIcon" class="size-4" aria-hidden="true" />
          {{ requestBinder.isPending.value ? "Building…" : "Export this file" }}
        </BaseButton>
      </template>
    </PageHeader>

    <BaseCard v-if="driverQ.data.value" padding="sm">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold text-ink">{{ driverQ.data.value.full_name }}</h2>
          <p class="mt-1 text-sm text-ink-muted">Driver qualification file</p>
        </div>
        <StatusBadge :status="driverQ.data.value.status" />
      </div>
    </BaseCard>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
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

    <FilterBar
      v-model:search="requirementSearch"
      search-placeholder="Search requirements…"
      :count="filteredRows.length"
      count-label="requirements"
    >
      <template #filters>
        <FilterSelect
          v-model="requirementGroup"
          label="Group"
          :options="requirementGroupOptions"
        />
      </template>
      <template #actions>
        <BaseButton variant="ghost" size="sm" @click="showAll = !showAll">
          {{
            showAll ? "Show only what needs attention" : `Show all ${file.items.length} requirements`
          }}
        </BaseButton>
      </template>
    </FilterBar>

    <DataTable
      :columns="columns"
      :rows="filteredRows"
      row-key="key"
      :loading="loading"
      :error="errorMessage"
      :retrying="retrying"
      :empty-text="
        hasRequirementFilter
          ? 'No requirements match these filters.'
          : showAll
            ? 'Nothing on file yet. Drop a document below to start.'
            : 'Nothing needs attention. This file is complete.'
      "
      @retry="retry"
    >
      <template #cell-label="{ row }">
        <span class="text-ink">{{ row.label }}</span>
        <span v-if="row.advisory" :class="['ml-2', BADGE_BASE, toneClass('neutral')]"
          >tracked, not required</span
        >
      </template>
      <template #cell-state="{ row }">
        <span :class="[BADGE_BASE, toneClass(STATE_TONE[row.state])]">{{
          STATE_LABEL[row.state]
        }}</span>
        <span v-if="row.expiryUnknown" class="mt-0.5 block text-xs text-warning-700"
          >No expiry recorded.</span
        >
      </template>
      <template #cell-evidenceDate="{ row }">
        <span v-if="row.evidenceDate">{{ formatDate(row.evidenceDate) }}</span>
        <span v-else class="text-ink-tertiary">—</span>
      </template>
      <template #cell-goodUntil="{ row }">
        <span v-if="row.goodUntil">{{ formatDate(row.goodUntil) }}</span>
        <span v-else class="text-ink-tertiary">—</span>
      </template>
      <template #cell-documentUrl="{ row }">
        <span
          v-if="row.restricted && !session.restrictedAccess"
          class="text-xs text-ink-muted"
          >Restricted</span
        >
        <a
          v-else-if="row.documentUrl && row.documentIsImage"
          :href="row.documentUrl"
          target="_blank"
          rel="noopener"
          class="inline-block"
          :aria-label="`View scan for ${row.label}`"
        >
          <img
            :src="row.documentUrl"
            alt=""
            loading="lazy"
            class="h-8 w-12 rounded-control object-cover ring-1 ring-edge"
          />
        </a>
        <a
          v-else-if="row.documentUrl"
          :href="row.documentUrl"
          target="_blank"
          rel="noopener"
          class="inline-flex items-center gap-1 font-medium text-link hover:text-link-hover"
          :aria-label="`View scan for ${row.label}`"
        >
          <AppIcon :icon="EyeIcon" class="size-4" aria-hidden="true" />
          View
        </a>
        <span v-else class="text-ink-tertiary">—</span>
      </template>
      <template #actions="{ row }">
        <KebabMenu
          v-if="session.canManage && !(row.restricted && !session.restrictedAccess)"
          :trigger-label="`${row.state === 'missing' ? 'Record' : 'Renew'} ${row.label}`"
        >
          <BaseButton type="button" class="kebab-item" @click="openKey = row.key">
            <AppIcon
              :icon="row.state === 'missing' ? ClipboardDocumentCheckIcon : ArrowPathIcon"
              class="size-4"
              aria-hidden="true"
            />
            {{ row.state === "missing" ? "Record requirement" : "Renew requirement" }}
          </BaseButton>
          <BaseButton
            v-if="row.documentUrl"
            type="button"
            class="kebab-item"
            :disabled="releasing === row.key"
            @click="release(row)"
          >
            <AppIcon :icon="ArrowDownTrayIcon" class="size-4" aria-hidden="true" />
            {{ releasing === row.key ? "Preparing…" : "Release stamped copy" }}
          </BaseButton>
        </KebabMenu>
      </template>
    </DataTable>

    <DocumentDropCard
      v-if="session.canManage"
      :driver-id="driverId"
      :items="dropItems"
      @filed="onFiled"
    />

    <CertificationHistory :driver-id="driverId" />

    <RequirementDrawer
      :open="openKey !== null"
      :driver-id="driverId"
      :item-key="openKey"
      :preset-document="presetDoc"
      @close="closeDrawer"
    />
  </div>
</template>
