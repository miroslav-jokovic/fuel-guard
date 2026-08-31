<script setup lang="ts">
import type { DqGroup, DqItemState } from "@silvicom/shared";
import { AppIcon, AppButton as BaseButton } from "@silvicom/ui";
import { ArrowDownTrayIcon, ArrowPathIcon, ClipboardDocumentCheckIcon, EyeIcon } from "@silvicom/ui/icons";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import { BADGE_BASE, dqItemBadge, toneClass } from "@/lib/badges";
import { formatDate } from "@/lib/format";
import { useSessionStore } from "@/stores/session";

/**
 * The §391.51 requirements table — extracted from the qualification surface (now QualificationSection, D1) when B6's viewer wiring
 * pushed the page over the 500-line budget. The page owns the DATA (buildDqFile, filters, the
 * drawer, the viewer, the release mutation); this owns the RENDERING: state badges, the thumb cell
 * that loads 40 KB instead of 25 MB (B4), the restricted-evidence gating (Phase G), and the
 * advisory label (D8).
 */
export interface RequirementRow {
  key: string;
  label: string;
  group: DqGroup;
  state: DqItemState;
  evidenceDate: string | null;
  goodUntil: string | null;
  expiryUnknown: boolean;
  documentId: string | null;
  documentUrl: string | null;
  /** The 40 KB derivative for the cell (B4); falls back to the original until the derive job runs. */
  documentThumbUrl: string | null;
  documentIsImage: boolean;
  /** Phase G (D-DQ15): state visible to everyone; evidence and capture hidden when THIS reader
   *  may not read the requirement's evidence kinds — resolved by the caller, per reader. */
  restricted: boolean;
  /** Tracked-not-required (D8): renders only because evidence exists; labelled as such. */
  advisory: boolean;
}

defineProps<{
  rows: RequirementRow[];
  loading: boolean;
  error: string | null;
  retrying: boolean;
  emptyText: string;
  /** The row key whose stamped release is in flight — disables that row's release action. */
  releasingKey: string | null;
}>();
const emit = defineEmits<{
  retry: [];
  open: [key: string];
  preview: [row: RequirementRow];
  release: [row: RequirementRow];
}>();

const session = useSessionStore();

const columns: DataTableColumn[] = [
  { key: "label", label: "Requirement", width: "2xl", cellClass: "font-medium text-ink" },
  { key: "state", label: "Status", headerClass: "w-32" },
  { key: "evidenceDate", label: "Evidence date", headerClass: "w-36", cellClass: "text-ink-secondary" },
  { key: "goodUntil", label: "Good until", headerClass: "w-32", cellClass: "text-ink-secondary" },
  { key: "documentUrl", label: "Scan", headerClass: "w-24" },
];
</script>

<template>
  <DataTable
    :columns="columns"
    :rows="rows"
    row-key="key"
    :loading="loading"
    :error="error"
    :retrying="retrying"
    :empty-text="emptyText"
    @retry="emit('retry')"
  >
    <template #cell-label="{ row }">
      <span class="text-ink">{{ row.label }}</span>
      <span v-if="row.advisory" :class="['ml-2', BADGE_BASE, toneClass('neutral')]"
        >tracked, not required</span
      >
    </template>
    <template #cell-state="{ row }">
      <span :class="[BADGE_BASE, toneClass(dqItemBadge(row.state).tone)]">{{
        dqItemBadge(row.state).label
      }}</span>
      <span v-if="row.state === 'missing'" class="mt-0.5 block text-xs text-ink-muted"
        >Never recorded.</span
      >
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
      <span v-if="row.restricted" class="text-xs text-ink-muted"
        >Restricted</span
      >
      <!-- The cell loads the 40 KB thumb, never the original (B4); clicking opens the viewer (B6),
           which is where the legible `normalized` variant loads. -->
      <BaseButton
        v-else-if="row.documentUrl && row.documentIsImage"
        variant="ghost"
        class="inline-block p-0"
        :aria-label="`View scan for ${row.label}`"
        @click="emit('preview', row as RequirementRow)"
      >
        <img
          :src="row.documentThumbUrl ?? undefined"
          alt=""
          loading="lazy"
          class="h-8 w-12 rounded-control object-cover ring-1 ring-edge"
        />
      </BaseButton>
      <BaseButton
        v-else-if="row.documentUrl"
        variant="ghost"
        size="sm"
        class="px-0 font-medium text-link hover:text-link-hover"
        :aria-label="`View scan for ${row.label}`"
        @click="emit('preview', row as RequirementRow)"
      >
        <AppIcon :icon="EyeIcon" class="size-4" aria-hidden="true" />
        View
      </BaseButton>
      <span v-else class="text-ink-tertiary">—</span>
    </template>
    <template #actions="{ row }">
      <KebabMenu
        v-if="session.can('roster') && !row.restricted"
        :trigger-label="`${row.state === 'missing' ? 'Record' : 'Renew'} ${row.label}`"
      >
        <BaseButton type="button" class="kebab-item" @click="emit('open', row.key)">
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
          :disabled="releasingKey === row.key"
          @click="emit('release', row as RequirementRow)"
        >
          <AppIcon :icon="ArrowDownTrayIcon" class="size-4" aria-hidden="true" />
          {{ releasingKey === row.key ? "Preparing…" : "Release stamped copy" }}
        </BaseButton>
      </KebabMenu>
    </template>
  </DataTable>
</template>
