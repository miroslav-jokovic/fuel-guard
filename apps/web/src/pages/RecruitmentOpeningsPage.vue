<script setup lang="ts">
import { computed, ref } from "vue";
import type { OpeningStatus, OpeningView } from "@silvicom/shared";
import { AppButton as BaseButton, DataTable, DataWorkspace, FilterBar, useQueryState, type DataTableColumn } from "@silvicom/ui";
import KebabMenu from "@/components/KebabMenu.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDateTime } from "@/lib/format";
import OpeningDrawer from "@/features/recruitment/OpeningDrawer.vue";
import RecruitmentTabs from "@/features/recruitment/RecruitmentTabs.vue";
import { OPENING_STATUS_ACTION, OPENING_STATUS_LABEL, OPENING_STATUS_TONE, statusMovesFrom } from "@/features/recruitment/openingForm";
import { useOpeningsQuery, useSetOpeningStatus } from "@/features/recruitment/useOpenings";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";

/**
 * Openings (Q-AD43 (b)): what the carrier is hiring for, each one a brief an ad campaign can be made from. A tab
 * beside Campaigns because a campaign starts from an OPEN opening. The open opening is in the URL (`?opening=`),
 * as Campaigns keeps its campaign, so a link can open one; `?opening=new` is the new-opening drawer.
 */
const qs = useQueryState();
const session = useSessionStore();
const toast = useToastStore();
const openings = useOpeningsQuery();
const setStatus = useSetOpeningStatus();
const canManage = computed(() => session.can("recruitment"));

const openParam = qs.param("opening");
const editing = computed<OpeningView | null>(() => (openings.data.value ?? []).find((o) => o.id === openParam.value) ?? null);
const drawerOpen = computed(() => openParam.value === "new" || editing.value !== null);
const busy = ref<string | null>(null);

async function move(o: OpeningView, status: OpeningStatus): Promise<void> {
  busy.value = o.id;
  try {
    await setStatus.mutateAsync({ id: o.id, status });
    toast.success(`${o.current?.title ?? "Opening"} is now ${OPENING_STATUS_LABEL[status].toLowerCase()}`);
  } catch (e) {
    toast.error("Could not change the opening", e instanceof Error ? e.message : undefined);
  } finally {
    busy.value = null;
  }
}

const columns: DataTableColumn[] = [
  { key: "title", label: "Opening" },
  { key: "status", label: "Status" },
  { key: "version", label: "Version", numeric: true },
  { key: "saved", label: "Last saved" },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="What you are hiring for. A campaign is made from an open opening, and every save keeps the version before it." />
    <RecruitmentTabs />
    <DataWorkspace>
      <FilterBar>
        <template #actions>
          <BaseButton v-if="canManage" variant="primary" data-test="new-opening" @click="openParam = 'new'">New opening</BaseButton>
        </template>
      </FilterBar>
      <!-- ui-adoption: unpaged — a carrier has tens of openings, read in one answer (`listOpenings`). -->
      <DataTable
        :columns="columns"
        :rows="openings.data.value ?? []"
        embedded
        row-key="id"
        :loading="openings.isLoading.value"
        :error="openings.isError.value ? 'Could not load the openings.' : null"
        :retrying="openings.isFetching.value"
        empty-text="No openings yet. Add one to start a campaign."
      >
        <template #cell-title="{ row }">
          <BaseButton variant="link" class="font-medium" :data-test="`open-${row.id}`" @click="openParam = row.id">{{ row.current?.title ?? "Untitled" }}</BaseButton>
        </template>
        <template #cell-status="{ row }">
          <span :class="[BADGE_BASE, toneClass(OPENING_STATUS_TONE[row.status as OpeningStatus])]">{{ OPENING_STATUS_LABEL[row.status as OpeningStatus] }}</span>
        </template>
        <template #cell-version="{ row }">{{ row.current?.version ?? "" }}</template>
        <template #cell-saved="{ row }">
          <span v-if="row.current">{{ row.current.created_by_name }} · {{ formatDateTime(row.current.created_at) }}</span>
        </template>
        <template #actions="{ row }">
          <KebabMenu v-if="canManage">
            <BaseButton
              v-for="s in statusMovesFrom(row.status as OpeningStatus)"
              :key="s"
              class="kebab-item"
              :disabled="busy === row.id"
              :data-test="`move-${row.id}-${s}`"
              @click="move(row as OpeningView, s)"
            >
              {{ OPENING_STATUS_ACTION[s] }}
            </BaseButton>
          </KebabMenu>
        </template>
      </DataTable>
    </DataWorkspace>
    <OpeningDrawer :open="drawerOpen" :opening="editing" :can-manage="canManage" @close="openParam = ''" />
  </div>
</template>
