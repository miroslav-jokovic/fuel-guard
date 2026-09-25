<script setup lang="ts">
import { computed, ref } from "vue";
import {
  RECRUITMENT_TEMPLATES,
  RECRUITMENT_TEMPLATE_GROUP_LABELS,
  type RecruitmentTemplate,
} from "@silvicom/shared";
import { AppCard as BaseCard, AppButton as BaseButton } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import DocumentPreview from "@/components/DocumentPreview.vue";
import type { RenderedDocument } from "@/lib/documentDownload";
import RecruitmentTabs from "@/features/recruitment/RecruitmentTabs.vue";

/**
 * Blank documents to print when the electronic path fails (MV2, D-MVR2).
 *
 * ⚠ The rows are `RECRUITMENT_TEMPLATES`, and the permissions in it are `APPLICATION_RELEASE_ORDER`
 * — so the list here and the list the applicant signs on their link are one list. A seventh
 * permission appears in both or in neither.
 *
 * ⚠ Preview is `DocumentPreview`, the viewer every rendered document in this product uses, and it
 * carries Print and Download itself. A second viewer here would be the second of something the
 * design system says there is one of (D-DS18).
 */

const columns: DataTableColumn[] = [
  { key: "label", label: "Document" },
  { key: "group", label: "Stage" },
  { key: "when", label: "When it is signed" },
  { key: "actions", label: "", align: "center" },
];

const rows = computed(() =>
  RECRUITMENT_TEMPLATES.map((t) => ({ ...t, groupLabel: RECRUITMENT_TEMPLATE_GROUP_LABELS[t.group] })),
);

const viewing = ref<RecruitmentTemplate | null>(null);

const rendered = computed<RenderedDocument | null>(() =>
  viewing.value
    ? {
        path: `/api/recruitment/templates/${encodeURIComponent(viewing.value.key)}.pdf`,
        filename: `${viewing.value.key}.pdf`,
        source: "the carrier's current wording, with nobody's details on it",
      }
    : null,
);
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Blank documents to print when a driver cannot sign on their phone" />

    <RecruitmentTabs />

    <BaseCard>
      <p class="text-sm text-ink-muted">
        Each one is the same document the driver signs on their link, blank. After a driver signs a
        permission on paper, open their record, go to the <span class="font-medium text-ink-secondary">Permissions</span>
        step and choose <span class="font-medium text-ink-secondary">Record a paper signature</span>, with the scan.
      </p>
    </BaseCard>

    <BaseCard padding="none">
      <DataTable :columns="columns" :rows="rows" row-key="key" empty-text="No templates.">
        <template #cell-label="{ row }">
          <span class="font-medium text-ink">{{ row.label }}</span>
        </template>
        <template #cell-group="{ row }">
          <span class="text-ink-secondary">{{ row.groupLabel }}</span>
        </template>
        <template #cell-when="{ row }">
          <span class="text-xs text-ink-muted">{{ row.when }}</span>
        </template>
        <template #cell-actions="{ row }">
          <BaseButton size="sm" variant="secondary" @click="viewing = row">Preview and print</BaseButton>
        </template>
      </DataTable>
    </BaseCard>

    <DocumentPreview
      :open="viewing !== null"
      :label="viewing?.label ?? ''"
      :rendered="rendered"
      @close="viewing = null"
    />
  </div>
</template>
