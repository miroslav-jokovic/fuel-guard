<script setup lang="ts">
import { computed, ref } from "vue";
import {
  buildDqFile,
  DQ_GROUP_LABELS,
  dqAttention,
  dqCapturableSpecs,
  dqGroups,
  DQ_ITEMS,
  moduleEnabled,
  type DqFileItem,
  type DocumentRow,
} from "@silvicom/shared";
import { AppCard as BaseCard, AppButton as BaseButton, FilterBar, DataWorkspace, useQueryState } from "@silvicom/ui";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import { BADGE_BASE, dqItemBadge, toneClass } from "@/lib/badges";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useModulesQuery } from "@/composables/useModules";
import { useDriverQuery } from "@/composables/useDrivers";
import {
  useCertificationsQuery,
  useDispatchHoldQuery,
  useDocumentsQuery,
  useQualificationRecordsQuery,
} from "@/composables/useCompliance";
import DocumentDropCard from "@/components/files/DocumentDropCard.vue";
import ScreeningIdentityCard from "@/features/compliance/ScreeningIdentityCard.vue";
import RequirementDrawer from "@/components/files/RequirementDrawer.vue";
import CertificationHistory from "@/components/files/CertificationHistory.vue";
import DocumentPreview from "@/components/DocumentPreview.vue";
import RequirementTable, { type RequirementRow } from "@/components/files/RequirementTable.vue";
import type { FileSubject } from "@/components/files/fileSubject";
import { useExportDocument } from "@/composables/useDqExports";

/**
 * One driver's §391.51 file (DQ redesign, D-DQ7).
 *
 * A page, not a drawer: eighteen requirements, their documents and their history is a workspace. Not
 * a new nav section — the detail view of a list that already exists, the same move Loads made.
 *
 * The page is short when the file is clean and long when it is not (D-DQ8): complete groups collapse
 * to a single line, and the table shows what needs attention until you ask for everything.
 */
/** D1: a SECTION of the driver detail page, not a page — the host passes the driver id. */
const props = defineProps<{ driverId: string }>();
const session = useSessionStore();
const toast = useToastStore();
const driverId = computed(() => props.driverId);
/** This driver as a file subject — what the shared file components take (UNIT-FILES-PLAN UF0). */
const fileSubject = computed<FileSubject>(() => ({ type: "driver", id: props.driverId }));

const driverQ = useDriverQuery(driverId);
const subjectType = ref("driver");
const certsQ = useCertificationsQuery(subjectType, driverId);
const recordsQ = useQualificationRecordsQuery(driverId);
const docsQ = useDocumentsQuery(subjectType, driverId);
// A Med-Stop violation's day reaches only a testing-record reader (the api redacts it); for them the
// return-to-duty item appears and stays missing until a record dated on or after it (§7A.15).
const holdQ = useDispatchHoldQuery(driverId);
const modules = useModulesQuery();

const loading = computed(
  () =>
    driverQ.isLoading.value ||
    certsQ.isLoading.value ||
    recordsQ.isLoading.value ||
    docsQ.isLoading.value ||
    holdQ.isLoading.value ||
    modules.isLoading.value,
);
const retrying = computed(
  () =>
    driverQ.isFetching.value ||
    certsQ.isFetching.value ||
    recordsQ.isFetching.value ||
    docsQ.isFetching.value ||
    holdQ.isFetching.value ||
    modules.isFetching.value,
);
const errorMessage = computed<string | null>(() => {
  const failed = [driverQ, certsQ, recordsQ, docsQ, holdQ, modules].find((q) => q.isError.value);
  return failed ? "Could not load the qualification file." : null;
});
function retry(): void {
  void driverQ.refetch();
  void certsQ.refetch();
  void recordsQ.refetch();
  void docsQ.refetch();
  void holdQ.refetch();
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
    // §40.25(j) (0237). Without this the file would never show the requirement, and the paperwork
    // that lifts a dispatch block would have nowhere to be filed from.
    returnToDutyRequired: driverQ.data.value?.return_to_duty_required === true,
    returnToDutyViolationOn: holdQ.data.value?.violationOn ?? null,
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

// The requirement list's state lives in the URL (D-US2), so Back from a document returns to the
// same narrowed list. Scoped `dq.`: this section shares the driver page's route with the page's own
// `?section=` and with the other sections' lists, and an unscoped `?search=` would be theirs too.
const qs = useQueryState("dq");
const showAll = qs.flag("all");

const docById = computed(() => {
  const m = new Map<string, DocumentRow>();
  for (const d of docsQ.data.value ?? []) if (d.url) m.set(d.id, d);
  return m;
});

// ── the viewer (B6): thumb in the cell, normalized in the modal, original only on Download ───────
const previewDocId = ref<string | null>(null);
const previewLabel = ref("");
const previewDoc = computed(() =>
  previewDocId.value ? (docById.value.get(previewDocId.value) ?? null) : null,
);
function openPreview(row: { documentId: string | null; label: string }): void {
  if (!row.documentId) return;
  previewDocId.value = row.documentId;
  previewLabel.value = row.label;
}

type Row = RequirementRow;
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
    documentId: i.documentId,
    documentUrl: doc?.url ?? null,
    // An image falls back to its original until the derive job runs; a PDF never does — an <img> of a
    // PDF is a broken picture — so a PDF shows its page-1 thumb once it exists (D-UF10), else "View".
    documentThumbUrl: doc?.thumbUrl ?? (doc?.contentType.startsWith("image/") ? doc.url : null) ?? null,
    documentIsImage: doc?.contentType.startsWith("image/") ?? false,
    // "restricted from THIS reader", not "restricted in general" — after auth.ts's split a
    // recruiter may read a previous-employer response while a dispatcher may not, so the flag
    // has to be resolved per reader here rather than re-gated in the table.
    restricted: i.spec.evidenceKinds.some((k) => !session.canReadKind(k)),
    advisory: i.spec.advisory === true,
  };
};

const rows = computed<Row[]>(() =>
  file.value.items.filter((i) => showAll.value || attentionKeys.value.has(i.spec.key)).map(toRow),
);
const requirementSearch = qs.param("search");
// Checked against the shared group catalogue rather than a copy of it.
const requirementGroup = qs.param("group", Object.keys(DQ_GROUP_LABELS));
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
// "Show all N requirements" is not counted or cleared: it chooses which list this is (what needs
// attention, or the whole file) and has its own toggle; search and group narrow whichever is shown.
const requirementFilterCount = computed(
  () => [requirementSearch.value.trim(), requirementGroup.value].filter(Boolean).length,
);
const hasRequirementFilter = computed(() => requirementFilterCount.value > 0);
function clearRequirementFilters(): void {
  qs.set({ search: undefined, group: undefined });
}


// ── releasing a document (D-BD10) ─────────────────────────────────────────────────────
//
// Internal sharing is ACCESS, not attachment: dispatch can already open this page, so "dispatch
// needs the CDL" is answered by a link. This is the outward case — a broker or shipper who has no
// login — and what makes it safe to send is the stamp: driver, requirement, validity, who released
// it, so a page that surfaces in somebody's inbox six months later can still be traced.
const exportDoc = useExportDocument();
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
    returnToDutyRequired: driverQ.data.value?.return_to_duty_required === true,
    returnToDutyViolationOn: holdQ.data.value?.violationOn ?? null,
  })
    .filter(
      (spec) =>
        spec.evidenceKinds.every((k) => session.canReadKind(k)),
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

    <!-- Above the group tiles on purpose: the tiles answer "what does this file still need", and a
         driver with no date of birth cannot be screened at all, which is upstream of every one of
         them (PSP-PLAN.md P0). -->
    <ScreeningIdentityCard :driver="driverQ.data.value ?? null" />

    <!-- The tiles are a verdict on the file, built from five reads; before they answered they read
         every group "Blocked" (F10, US6b). They wait; the table below draws the loading line and the
         failure with its Retry, from the same reads. -->
    <div v-if="!loading && !errorMessage" class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <BaseCard v-for="g in groups" :key="g.group" padding="sm">
        <p class="text-sm font-medium text-ink">{{ g.label }}</p>
        <p class="mt-2">
          <span :class="[BADGE_BASE, toneClass(dqItemBadge(g.state).tone)]">{{
            dqItemBadge(g.state).label
          }}</span>
        </p>
        <p v-if="g.state !== 'current'" class="mt-2 text-xs text-ink-muted">
          {{ g.counts.expired + g.counts.missing }} blocked · {{ g.counts.expiring }} expiring
        </p>
      </BaseCard>
    </div>

    <DataWorkspace>
      <FilterBar
        v-model:search="requirementSearch"
        search-placeholder="Search requirements…"
        :count="filteredRows.length"
        count-label="requirements"
        embedded
        :active-count="requirementFilterCount"
        @clear-all="clearRequirementFilters"
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

      <!-- ui-adoption: unpaged — one driver's requirements are a filter of the shared DQ_ITEMS catalogue (20 entries, packages/shared dqCatalogue.ts), so the list never passes one page (D-US8). -->
      <RequirementTable
        :rows="filteredRows"
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
        :releasing-key="releasing"
        :can-manage="session.can('roster')"
        embedded
        @retry="retry"
        @open="openKey = $event"
        @preview="openPreview"
        @release="release"
      />
    </DataWorkspace>

    <DocumentDropCard
      v-if="session.can('roster')"
      :subject="fileSubject"
      :items="dropItems"
      @filed="onFiled"
    />

    <CertificationHistory :subject="fileSubject" />

    <RequirementDrawer
      :open="openKey !== null"
      :subject="fileSubject"
      :specs="DQ_ITEMS"
      :item-key="openKey"
      :preset-document="presetDoc"
      @close="closeDrawer"
    />

    <DocumentPreview
      :open="previewDoc !== null"
      :label="previewLabel"
      :doc="previewDoc"
      @close="previewDocId = null"
    />
  </div>
</template>
