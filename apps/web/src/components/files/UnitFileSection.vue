<script setup lang="ts">
import { computed, ref } from "vue";
import {
  EQUIPMENT_GROUP_LABELS,
  EQUIPMENT_ITEMS,
  OWNERSHIP_LABELS,
  OWNERSHIP_TYPES,
  unitFileSpecs,
  unitGroups,
  type DocumentRow,
  type OwnershipType,
  type UnitFileCell,
  type UnitFileItem,
  type UnitFileRow,
} from "@silvicom/shared";
import { AppCallout, AppCard as BaseCard, AppButton as BaseButton, AppSelect, FilterBar, DataWorkspace, useQueryState } from "@silvicom/ui";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import { BADGE_BASE, dqItemBadge, toneClass } from "@/lib/badges";
import { formatDate } from "@/lib/format";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useDocumentsQuery, useUnitFilesQuery } from "@/composables/useCompliance";
import { useVehiclesQuery, useSetVehicleOwnership } from "@/composables/useVehicles";
import { useTrailersQuery, useSetTrailerOwnership } from "@/composables/useTrailers";
import DocumentDropCard from "@/components/files/DocumentDropCard.vue";
import RequirementDrawer from "@/components/files/RequirementDrawer.vue";
import CertificationHistory from "@/components/files/CertificationHistory.vue";
import DocumentPreview from "@/components/DocumentPreview.vue";
import RequirementTable, { type RequirementRow } from "@/components/files/RequirementTable.vue";
import UnitRelationStrip from "./UnitRelationStrip.vue";
import type { UnitFileSubject } from "./fileSubject";

/**
 * One truck's or trailer's file, as a section of its page (UNIT-FILES-PLAN UF5, D-UF1).
 *
 * The file is the ROLLUP's row for this unit — `GET /api/compliance/unit-files`, the read the Vehicles
 * and Trailers lists draw their cell from — never a second build in the browser: the list's chip and
 * this page's rows come from one `buildUnitFile` call on the server, so they cannot disagree about
 * the same truck. The page adds only what a list cell does not need: the papers' signed URLs for the
 * scan column and the viewer, the catalogue's labels, and the relations (D-UF2).
 *
 * What a driver's `QualificationSection` has and this does not, by decision rather than omission:
 * no stamped release (D-BD10 stamps a driver), no restricted kinds (equipment has none), no group
 * tiles for groups the unit does not have. "Print QR label" (UF9) and "Build binder" (UF8) are
 * HIDDEN until those steps ship — not drawn disabled, which would promise them.
 *
 * Writes are the equipment section's (D-UF5): a reader without `equipment: manage` sees the rows and
 * no drop zone, no drawer and no ownership control.
 */
const props = defineProps<{
  subject: UnitFileSubject;
  /** "654" — for the drawer's title and the accessible names. */
  unitNumber: string;
  plate?: string | null;
}>();

const session = useSessionStore();
const toast = useToastStore();
const canManage = computed(() => session.can("equipment"));
const subjectType = computed(() => props.subject.type);
const subjectId = computed<string | null>(() => props.subject.id);

const filesQ = useUnitFilesQuery(props.subject.type);
const docsQ = useDocumentsQuery(subjectType, subjectId);
const row = computed<UnitFileRow | null>(() => (filesQ.data.value?.units ?? []).find((u) => u.subject_id === props.subject.id) ?? null);

const loading = computed(() => filesQ.isLoading.value || docsQ.isLoading.value);
const retrying = computed(() => filesQ.isFetching.value || docsQ.isFetching.value);
const errorMessage = computed<string | null>(() => (filesQ.isError.value || docsQ.isError.value ? "Could not load this unit's file." : null));
function retry(): void {
  void filesQ.refetch();
  void docsQ.refetch();
}

const specByKey = new Map(EQUIPMENT_ITEMS.map((s) => [s.key, s]));
/**
 * The rollup's cells as the engine's items, so the group tiles come from `unitGroups` — the same fold
 * the driver page's tiles use — rather than a second count written here.
 */
const items = computed<UnitFileItem[]>(() =>
  (row.value?.items ?? []).flatMap((c) => {
    const spec = specByKey.get(c.key);
    return spec ? [{ spec, state: c.state, goodUntil: c.goodUntil, evidenceDate: c.evidenceDate, expiryUnknown: c.expiryUnknown, documentId: c.documentId, dateOnly: c.dateOnly, paperOnFile: c.paperOnFile, fleetWide: c.fleetWide }] : [];
  }),
);
const groups = computed(() =>
  row.value
    ? unitGroups({
        items: items.value,
        state: row.value.state,
        counts: row.value.counts,
        ownershipUnknown: row.value.ownership_unknown.flatMap((k) => specByKey.get(k) ?? []),
      })
    : [],
);

// ── the ownership question (D-UF11) ──────────────────────────────────────────────────────────────
// Title and lease wait on it: while it is unknown they are neither required nor missing, and the office
// answers it here, where it is asked, rather than in the form two screens away.
const vehicles = useVehiclesQuery();
const trailers = useTrailersQuery();
const ownership = computed<OwnershipType | null>(() => {
  const unit = props.subject.type === "tractor"
    ? (vehicles.data.value ?? []).find((v) => v.id === props.subject.id)
    : (trailers.data.value ?? []).find((t) => t.id === props.subject.id);
  return unit?.ownership_type ?? row.value?.ownership ?? null;
});
const ownershipUnknownLabels = computed(() => (row.value?.ownership_unknown ?? []).map((k) => specByKey.get(k)?.label ?? k));
const setVehicleOwnership = useSetVehicleOwnership();
const setTrailerOwnership = useSetTrailerOwnership();
const ownershipOptions = [{ value: "", label: "Choose…" }, ...OWNERSHIP_TYPES.map((o) => ({ value: o, label: OWNERSHIP_LABELS[o] }))];
const ownershipChoice = ref("");
async function saveOwnership(): Promise<void> {
  const choice = ownershipChoice.value as OwnershipType | "";
  if (!choice) return;
  try {
    const payload = { id: props.subject.id, ownership: choice };
    await (props.subject.type === "tractor" ? setVehicleOwnership.mutateAsync(payload) : setTrailerOwnership.mutateAsync(payload));
    toast.success("Ownership set", `${OWNERSHIP_LABELS[choice]} — the file now asks for the right paper.`);
  } catch (e) {
    toast.error("Could not set ownership", e instanceof Error ? e.message : undefined);
  }
}

// ── the rows ──────────────────────────────────────────────────────────────────────────────────────
const qs = useQueryState("uf");
const showAll = qs.flag("all");
const docById = computed(() => {
  const m = new Map<string, DocumentRow>();
  for (const d of docsQ.data.value ?? []) if (d.url) m.set(d.id, d);
  return m;
});
const needsAttention = (c: UnitFileCell) => c.state !== "current";
const toRow = (c: UnitFileCell): RequirementRow => {
  const spec = specByKey.get(c.key);
  // A paper on file that nobody has dated (Q-UF13) is drawn and opened like evidence — it is the
  // thing the office reads the date off — while the row's state stays what the engine says: missing.
  const docId = c.documentId ?? c.paperOnFile?.documentId ?? null;
  const doc = docId ? docById.value.get(docId) : undefined;
  return {
    key: c.key,
    label: spec?.label ?? c.key,
    group: c.group,
    state: c.state,
    evidenceDate: c.evidenceDate,
    goodUntil: c.goodUntil,
    expiryUnknown: c.expiryUnknown,
    documentId: docId,
    // A fleet paper is filed on the organization (D-UF6): its URL is not in this unit's documents,
    // so the cell says it is covered and the paper is opened from the fleet's own file.
    documentUrl: doc?.url ?? null,
    documentThumbUrl: doc?.thumbUrl ?? (doc?.contentType.startsWith("image/") ? doc.url : null) ?? null,
    documentIsImage: doc?.contentType.startsWith("image/") ?? false,
    restricted: false,
    advisory: false,
    note: c.paperOnFile
      ? `Paper on file, not dated${c.dateOnly ? ` — McLeod says ${formatDate(c.dateOnly.goodUntil)}` : ""}`
      : c.dateOnly
      ? `Date only, no paper — McLeod says ${formatDate(c.dateOnly.goodUntil)}`
      : c.fleetWide
        ? "Covered by the fleet's paper"
        : null,
  };
};
const rows = computed<RequirementRow[]>(() => (row.value?.items ?? []).filter((c) => showAll.value || needsAttention(c)).map(toRow));
const search = qs.param("search");
const group = qs.param("group", Object.keys(EQUIPMENT_GROUP_LABELS));
const groupOptions = [{ value: "", label: "All groups" }, ...Object.entries(EQUIPMENT_GROUP_LABELS).map(([value, label]) => ({ value, label }))];
const filteredRows = computed(() => {
  const term = search.value.trim().toLowerCase();
  return rows.value.filter((r) => (!group.value || r.group === group.value) && (!term || r.label.toLowerCase().includes(term)));
});
const filterCount = computed(() => [search.value.trim(), group.value].filter(Boolean).length);
function clearFilters(): void {
  qs.set({ search: undefined, group: undefined });
}

// ── the viewer, the drawer, the drop card ─────────────────────────────────────────────────────────
const previewDocId = ref<string | null>(null);
const previewLabel = ref("");
const previewDoc = computed(() => (previewDocId.value ? (docById.value.get(previewDocId.value) ?? null) : null));
function openPreview(r: RequirementRow): void {
  if (!r.documentId) return;
  previewDocId.value = r.documentId;
  previewLabel.value = `${label.value} — ${r.label}`;
}
const label = computed(() => `${props.subject.type === "tractor" ? "Unit" : "Trailer"} ${props.unitNumber}`);

const openKey = ref<string | null>(null);
const presetDoc = ref<{ id: string; name: string } | null>(null);
function closeDrawer(): void {
  openKey.value = null;
  presetDoc.value = null;
}
/** What a dropped scan can prove: the items that apply to this unit, by its type and ownership. */
const dropItems = computed(() =>
  unitFileSpecs(props.subject.type, ownership.value).specs.map((s) => ({ key: s.key, label: s.label, evidenceKind: s.evidenceKinds[0] ?? "other" })),
);
/**
 * Recording an item opens the drawer; for an item whose paper is on file but not dated (Q-UF13) the
 * drawer CITES that paper, as it does a drop-first scan (D-DQ10), so the office types the date it reads
 * off the scan and uploads nothing. This is how the McLeod import's papers get their certifications.
 */
function openRequirement(key: string): void {
  const paper = row.value?.items.find((c) => c.key === key)?.paperOnFile ?? null;
  presetDoc.value = paper ? { id: paper.documentId, name: `The paper dated ${formatDate(paper.datedAt)}` } : null;
  openKey.value = key;
}
function onFiled(payload: { documentId: string; name: string; key: string }): void {
  presetDoc.value = { id: payload.documentId, name: payload.name };
  openKey.value = payload.key;
}
</script>

<template>
  <div class="space-y-6">
    <BaseCard>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-sm font-semibold text-ink">File</h2>
          <p class="mt-1 text-xs text-ink-muted">{{ label }}<template v-if="plate"> · plate {{ plate }}</template></p>
        </div>
        <!-- "Print QR label" (UF9) and "Build binder" (UF8) stand here once they ship. -->
      </div>
      <UnitRelationStrip class="mt-4" :subject="subject" />
    </BaseCard>

    <AppCallout v-if="ownershipUnknownLabels.length" tone="warning" data-test="ownership-unknown">
      <p class="text-sm text-ink">
        Set ownership to check: {{ ownershipUnknownLabels.join(", ") }}. A title is asked of an owned unit, a lease of a leased one; until it is set neither counts as missing.
      </p>
      <div v-if="canManage" class="mt-3 flex items-center gap-2">
        <AppSelect v-model="ownershipChoice" :options="ownershipOptions" class="max-w-56" />
        <BaseButton size="sm" variant="primary" :disabled="!ownershipChoice || setVehicleOwnership.isPending.value || setTrailerOwnership.isPending.value" @click="saveOwnership">Set ownership</BaseButton>
      </div>
    </AppCallout>

    <!-- The tiles are a verdict on the file; before the read answers they would read every group
         "Blocked", so they wait, and the table below carries the loading line and the retry. -->
    <div v-if="!loading && !errorMessage && groups.length" class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <BaseCard v-for="g in groups" :key="g.group" padding="sm">
        <p class="text-sm font-medium text-ink">{{ g.label }}</p>
        <p class="mt-2">
          <span :class="[BADGE_BASE, toneClass(dqItemBadge(g.state).tone)]">{{ dqItemBadge(g.state).label }}</span>
        </p>
        <p v-if="g.state !== 'current'" class="mt-2 text-xs text-ink-muted">
          {{ g.counts.expired + g.counts.missing }} blocked · {{ g.counts.expiring }} expiring
        </p>
      </BaseCard>
    </div>

    <p v-if="!loading && !errorMessage && !row" class="text-sm text-ink-muted">This unit is not in the file rollup yet.</p>

    <DataWorkspace>
      <FilterBar v-model:search="search" search-placeholder="Search requirements…" :count="filteredRows.length" count-label="requirements" embedded :active-count="filterCount" @clear-all="clearFilters">
        <template #filters>
          <FilterSelect v-model="group" label="Group" :options="groupOptions" />
        </template>
        <template #actions>
          <BaseButton variant="ghost" size="sm" @click="showAll = !showAll">
            {{ showAll ? "Show only what needs attention" : `Show all ${row?.items.length ?? 0} requirements` }}
          </BaseButton>
        </template>
      </FilterBar>
      <!-- ui-adoption: unpaged — one unit's requirements are a filter of EQUIPMENT_ITEMS (seven entries, packages/shared equipmentFileCatalogue.ts), so the list never passes one page (D-US8). -->
      <RequirementTable
        :rows="filteredRows"
        :loading="loading"
        :error="errorMessage"
        :retrying="retrying"
        :empty-text="filterCount ? 'No requirements match these filters.' : showAll ? 'Nothing on file yet. Drop a paper below to start.' : 'Nothing needs attention. This file is complete.'"
        :releasing-key="null"
        :can-manage="canManage"
        :releasable="false"
        embedded
        @retry="retry"
        @open="openRequirement"
        @preview="openPreview"
      />
    </DataWorkspace>

    <DocumentDropCard v-if="canManage" :subject="subject" :items="dropItems" @filed="onFiled" />

    <CertificationHistory :subject="subject" />

    <RequirementDrawer :open="openKey !== null" :subject="subject" :specs="EQUIPMENT_ITEMS" :item-key="openKey" :preset-document="presetDoc" @close="closeDrawer" />

    <DocumentPreview :open="previewDoc !== null" :label="previewLabel" :doc="previewDoc" @close="previewDocId = null" />
  </div>
</template>
