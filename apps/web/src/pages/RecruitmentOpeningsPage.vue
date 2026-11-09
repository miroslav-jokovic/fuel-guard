<script setup lang="ts">
import { computed, ref } from "vue";
import type { OpeningStatus, OpeningView } from "@silvicom/shared";
import { AppButton as BaseButton, AppSelect, DataTable, DataWorkspace, FilterBar, useQueryState, type DataTableColumn, type SelectOption } from "@silvicom/ui";
import KebabMenu from "@/components/KebabMenu.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDateTime } from "@/lib/format";
import OpeningDrawer from "@/features/recruitment/OpeningDrawer.vue";
import RecruitmentTabs from "@/features/recruitment/RecruitmentTabs.vue";
import { OPENING_STATUS_ACTION, OPENING_STATUS_LABEL, OPENING_STATUS_TONE, statusMovesFrom } from "@/features/recruitment/openingForm";
import { useOpeningsQuery, useRecruitersQuery, useSetOpeningRecruiter, useSetOpeningStatus } from "@/features/recruitment/useOpenings";
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
const recruiters = useRecruitersQuery();
const setRecruiter = useSetOpeningRecruiter();

/**
 * Who owns an opening's leads (LQ2b, Q-AD50 (a)): its recruiter is rung for each new ad lead; "Everyone" rings
 * every recruitment manager, as before. The list is the API's (the access matrix's recruitment managers). A
 * recruiter who has since lost that access still shows, by what they are now, so the row does not pretend the
 * opening is everyone's — the API already rings everyone for it.
 */
const EVERYONE = "Everyone in recruiting";
const NOT_A_RECRUITER = "Someone without recruiting access";
function recruiterOptions(current: string | null): SelectOption[] {
  const list = recruiters.data.value ?? [];
  const opts: SelectOption[] = [{ value: null, label: EVERYONE }, ...list.map((r) => ({ value: r.user_id, label: r.label }))];
  if (current && !list.some((r) => r.user_id === current)) opts.push({ value: current, label: NOT_A_RECRUITER, disabled: true });
  return opts;
}
function recruiterLabel(current: string | null): string {
  if (!current) return EVERYONE;
  return recruiters.data.value?.find((r) => r.user_id === current)?.label ?? NOT_A_RECRUITER;
}
async function assign(o: OpeningView, value: unknown): Promise<void> {
  // AppSelect answers the "Everyone" option as its own value, null.
  const recruiter_id = typeof value === "string" ? value : null;
  if (recruiter_id === o.recruiter_id) return;
  busy.value = o.id;
  try {
    await setRecruiter.mutateAsync({ id: o.id, recruiter_id });
    toast.success(`New leads for ${o.current?.title ?? "this opening"} now go to ${recruiter_id ? recruiterLabel(recruiter_id) : "everyone in recruiting"}`);
  } catch (e) {
    toast.error("Could not change the recruiter", e instanceof Error ? e.message : undefined);
  } finally {
    busy.value = null;
  }
}

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
  { key: "recruiter", label: "Recruiter" },
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
        <template #cell-recruiter="{ row }">
          <AppSelect
            v-if="canManage && recruiters.data.value"
            :model-value="(row as OpeningView).recruiter_id"
            :options="recruiterOptions((row as OpeningView).recruiter_id)"
            placeholder=""
            :aria-label="`Recruiter for ${row.current?.title ?? 'this opening'}`"
            :disabled="busy === row.id"
            :data-test="`recruiter-${row.id}`"
            @update:model-value="assign(row as OpeningView, $event)"
          />
          <span v-else :data-test="`recruiter-${row.id}`">{{ recruiterLabel((row as OpeningView).recruiter_id) }}</span>
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
