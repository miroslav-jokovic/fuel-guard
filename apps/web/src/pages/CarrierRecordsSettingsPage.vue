<script setup lang="ts">
import { computed, ref } from "vue";
import { AppCallout, DataWorkspace } from "@silvicom/ui";
import {
  buildCarrierFile,
  carrierFileSpecs,
  CARRIER_ITEMS,
  DQ_KIND_LABELS,
  FLEET_WIDE_UNIT_KINDS,
  fileSectionFor,
  moduleEnabled,
  type DocumentRow,
} from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import DocumentPreview from "@/components/DocumentPreview.vue";
import CertificationHistory from "@/components/files/CertificationHistory.vue";
import DocumentDropCard from "@/components/files/DocumentDropCard.vue";
import RequirementDrawer from "@/components/files/RequirementDrawer.vue";
import RequirementTable, { type RequirementRow } from "@/components/files/RequirementTable.vue";
import type { FileSubject } from "@/components/files/fileSubject";
import { useCertificationsQuery, useDocumentsQuery } from "@/composables/useCompliance";
import { useModulesQuery } from "@/composables/useModules";
import { useSessionStore } from "@/stores/session";

/**
 * Settings › Carrier records (DQ-INTO-DRIVERS-PLAN DD3, D-DQ20; a file since DD5, D-DQ23): the records
 * the carrier itself holds, as a file like a driver's or a truck's — each requirement a row with its
 * state, recorded through `RequirementDrawer`, which uploads the scan BEFORE it writes the record
 * (D-DQ10). Until DD5 this was `CertManager`, a form that wrote a date with nothing behind it, so a
 * PHMSA registration could be "on file until 06/30/2027" with no paper an auditor could open (Q-DD4).
 *
 * ── ITS SURFACE, `safety.carrier-records` (D-DQ20) ──────────────────────────────────────────────
 * A card in Settings rather than a section of Organization: `admin.settings.org` is one screen with
 * one gate (`settings: manage`), a safety manager holds `settings: none`, and a section cannot carry
 * a different permission from its page. Gated on `roster`, because most of these are the qualification
 * side's records.
 *
 * ⚠ `startsOnFor` NAMES fleet_manager and safety_manager, against Q-SET2 ("every Settings screen starts
 * admin-only", 2026-09-30). The owner's ruling of 2026-11-05 (Q-DD1 (a), carrier records stay with the
 * safety manager) is the later and narrower one, and those are the two roles holding `roster: manage`
 * that filed these on the old page. It also means the Settings entry reappears in their sidebar, with
 * this one card behind it. An admin can switch it off per role or per person.
 *
 * ── WHO MAY RECORD WHICH ROW (D-DQ23 §3) ────────────────────────────────────────────────────────
 * Per row, from the matrix: a paper belongs to the section `fileSectionFor("organization", kind)` names,
 * which is the question `POST /api/compliance/certifications` and `/documents` ask. So the fleet's
 * insurance and IFTA (equipment) are not offered to a safety manager (equipment: view), and the carrier's
 * own records (roster) are. Nothing here names a role.
 *
 * ── WHY THE CALLOUT ─────────────────────────────────────────────────────────────────────────────────
 * Insurance and IFTA are filed ONCE, here, for the whole fleet (UNIT-FILES-PLAN D-UF6), and every
 * tractor's file counts them. Measured on production 2026-11-05: the carrier had filed neither (no
 * organization record of any kind), so every truck's File filter read "missing" on both. The callout
 * names what is missing and what that does to the trucks; it goes as soon as both are on file.
 */
const session = useSessionStore();
const orgId = computed(() => session.orgId ?? null);
const subjectType = ref("organization");
const subject = computed<FileSubject | null>(() => (orgId.value ? { type: "organization", id: orgId.value } : null));

const certsQ = useCertificationsQuery(subjectType, orgId);
const docsQ = useDocumentsQuery(subjectType, orgId);
const modules = useModulesQuery();
const includeHazmat = computed(() => moduleEnabled(modules.data.value ?? null, "hazmatguard"));

const loading = computed(() => certsQ.isLoading.value || docsQ.isLoading.value);
const retrying = computed(() => certsQ.isFetching.value || docsQ.isFetching.value);
const errorMessage = computed(() => (certsQ.isError.value || docsQ.isError.value ? "Could not load the carrier's records." : null));
function retry(): void {
  void certsQ.refetch();
  void docsQ.refetch();
}

const docById = computed(() => {
  const m = new Map<string, DocumentRow>();
  for (const d of docsQ.data.value ?? []) if (d.url) m.set(d.id, d);
  return m;
});
const today = new Date().toISOString().slice(0, 10);
const file = computed(() =>
  buildCarrierFile({
    certs: (certsQ.data.value ?? []).map((c) => ({ kind: c.kind, issuedAt: c.issued_at, expiresAt: c.expires_at, documentId: c.document_id })),
    documentIds: new Set((docsQ.data.value ?? []).map((d) => d.id)),
    today,
    includeHazmat: includeHazmat.value,
  }),
);

const specByKey = new Map(CARRIER_ITEMS.map((s) => [s.key, s]));
/** The section a row's paper belongs to manages it (D-UF5) — per row, since this file holds two. */
const mayRecord = (key: string): boolean => {
  const kind = specByKey.get(key)?.evidenceKinds[0];
  return kind != null && session.can(fileSectionFor("organization", kind));
};

const rows = computed<RequirementRow[]>(() =>
  file.value.items.map((i) => {
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
      documentThumbUrl: doc?.thumbUrl ?? (doc?.contentType.startsWith("image/") ? doc.url : null) ?? null,
      documentIsImage: doc?.contentType.startsWith("image/") ?? false,
      restricted: i.spec.evidenceKinds.some((k) => !session.canReadKind(k)),
      advisory: i.spec.advisory === true,
    };
  }),
);

/**
 * What the drop card offers: every item this reader may record, including the conditional hazmat ones
 * that have no row until something is filed (`advisory`, D-DQ23 §4) — this is where the first one comes
 * from, as a driver's ELDT does.
 */
const dropItems = computed(() =>
  carrierFileSpecs({ includeHazmat: includeHazmat.value })
    .filter((s) => mayRecord(s.key))
    .map((s) => ({ key: s.key, label: s.label, evidenceKind: s.evidenceKinds[0] ?? "other" })),
);

const missingFleetPapers = computed(() => {
  if (!certsQ.data.value) return [];
  const filed = new Set(certsQ.data.value.map((c) => c.kind));
  return FLEET_WIDE_UNIT_KINDS.filter((k) => !filed.has(k));
});
const missingLabel = computed(() => missingFleetPapers.value.map((k) => DQ_KIND_LABELS[k] ?? k).join(" and "));
const canFileFleetPapers = computed(() => missingFleetPapers.value.every((k) => session.can(fileSectionFor("organization", k))));

// ── the drawer and the viewer ─────────────────────────────────────────────────────────────────────
const openKey = ref<string | null>(null);
const presetDoc = ref<{ id: string; name: string } | null>(null);
function openRequirement(key: string): void {
  presetDoc.value = null;
  openKey.value = key;
}
function onFiled(payload: { documentId: string; name: string; key: string }): void {
  presetDoc.value = { id: payload.documentId, name: payload.name };
  openKey.value = payload.key;
}
function closeDrawer(): void {
  openKey.value = null;
  presetDoc.value = null;
}
const previewDocId = ref<string | null>(null);
const previewLabel = ref("");
const previewDoc = computed(() => (previewDocId.value ? (docById.value.get(previewDocId.value) ?? null) : null));
function openPreview(r: RequirementRow): void {
  if (!r.documentId) return;
  previewDocId.value = r.documentId;
  previewLabel.value = `Carrier — ${r.label}`;
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      description="The carrier's own records, each with the scan an auditor can open: operating authority, the fleet's insurance and IFTA, and with HazmatGuard the PHMSA registration and hazmat papers."
    />

    <AppCallout v-if="missingFleetPapers.length" tone="caution" data-testid="fleet-papers-missing">
      {{ missingLabel }} {{ missingFleetPapers.length === 1 ? "is" : "are" }} not on file. Every truck's
      file counts {{ missingFleetPapers.length === 1 ? "it" : "them" }} as missing until the company's
      {{ missingFleetPapers.length === 1 ? "is" : "are" }} filed here.
      <template v-if="!canFileFleetPapers">Filing {{ missingFleetPapers.length === 1 ? "it" : "them" }} needs permission to manage vehicles.</template>
    </AppCallout>

    <DataWorkspace>
      <!-- ui-adoption: unpaged — the carrier's requirements are a filter of CARRIER_ITEMS (eight entries, packages/shared carrierFileCatalogue.ts), so the list never passes one page (D-US8). -->
      <RequirementTable
        :rows="rows"
        :loading="loading"
        :error="errorMessage"
        :retrying="retrying"
        empty-text="No carrier records apply."
        :releasing-key="null"
        :can-manage="mayRecord"
        :releasable="false"
        embedded
        @retry="retry"
        @open="openRequirement"
        @preview="openPreview"
      />
    </DataWorkspace>

    <template v-if="subject">
      <DocumentDropCard v-if="dropItems.length" :subject="subject" :items="dropItems" @filed="onFiled" />
      <CertificationHistory :subject="subject" />
      <RequirementDrawer :open="openKey !== null" :subject="subject" :specs="CARRIER_ITEMS" :item-key="openKey" :preset-document="presetDoc" @close="closeDrawer" />
    </template>

    <DocumentPreview :open="previewDoc !== null" :label="previewLabel" :doc="previewDoc" @close="previewDocId = null" />
  </div>
</template>
