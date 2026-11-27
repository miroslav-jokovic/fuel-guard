<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { TrainingAssignmentRow } from "@silvicom/shared";
import { AppBadge, AppButton, AppCard as BaseCard, DataTable, DataWorkspace, FilterBar, TablePagination, useConfirm, useQueryState, type DataTableColumn } from "@silvicom/ui";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import { useToastStore } from "@/stores/toast";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { formatDateTime, formatPhone } from "@/lib/format";
import { useCancelTraining, useResendTraining, useTrainingAssignments } from "./useTraining";
import { LESSON_STATUS, lessonCell, STANDING, standing, VIA_LABEL, type AssignmentStanding } from "./trainingRows";

/**
 * Safety › Training › Progress (§8.3): who was sent what, and how far each driver got — per film, its
 * status and best quiz score. A record of what was sent and taken is kept for good (RETENTION_FORBIDDEN):
 * cancelling a link stops it working and leaves the record.
 */
defineProps<{ canManage: boolean }>();
const toast = useToastStore();
const ask = useConfirm();
const { zone } = useOrgTimezone();
const assignments = useTrainingAssignments();
const PAGE_SIZE = 50;
const qs = useQueryState();
const search = qs.param("search");
const show = qs.param("status", ["finished", "in_progress", "not_opened", "overdue", "cancelled"] as const);
const page = qs.page();
watch([search, show], () => (page.value = 1));

/** The office's calendar day, in the carrier's zone: a due date is a day, not an instant. */
const today = computed(() => new Intl.DateTimeFormat("en-CA", { timeZone: zone.value }).format(new Date()));
const all = computed(() => (assignments.data.value ?? []).map((a) => ({ ...a, standing: standing(a, today.value) })));
const rows = computed(() => {
  const q = search.value.trim().toLowerCase();
  // A phone-number recipient is found by their number too, however it is typed: "312 555" finds +1312555….
  const digits = q.replace(/\D/g, "");
  const matches = (a: TrainingAssignmentRow) =>
    a.driverName.toLowerCase().includes(q) || a.courseTitle.toLowerCase().includes(q) || (digits.length >= 3 && !!a.recipientPhone?.includes(digits));
  return all.value.filter((a) => (!show.value || a.standing === show.value) && (!q || matches(a)));
});
const pageRows = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
const counts = computed(() => {
  const c: Record<AssignmentStanding, number> = { finished: 0, in_progress: 0, not_opened: 0, overdue: 0, cancelled: 0 };
  for (const a of all.value) c[a.standing]++;
  return c;
});
const showOptions = (Object.keys(STANDING) as AssignmentStanding[]).map((k) => ({ value: k, label: STANDING[k].label }));

const columns: DataTableColumn[] = [
  { key: "driverName", label: "Driver or person" },
  { key: "sentAt", label: "Sent" },
  { key: "films", label: "Videos" },
  { key: "dueOn", label: "Due" },
  { key: "standing", label: "Status" },
];

const resend = useResendTraining();
const cancel = useCancelTraining();
const copied = ref<{ driverName: string; link: string } | null>(null);
async function doResend(a: TrainingAssignmentRow) {
  const ok = await ask({ title: `Send ${a.driverName} a new link?`, message: "The old link stops working. Progress so far is kept.", confirmLabel: "Send new link" });
  if (!ok) return;
  try {
    const out = await resend.mutateAsync(a.id);
    if (out.link) copied.value = { driverName: a.driverName, link: out.link };
    if (out.ok) toast.success("New link sent", out.link ? "Copy it below and send it yourself." : VIA_LABEL[out.via]);
    else toast.error("New link not sent", out.detail ?? undefined);
  } catch (e) {
    toast.error("New link not sent", e instanceof Error ? e.message : undefined);
  }
}
async function doCancel(a: TrainingAssignmentRow) {
  const ok = await ask({ title: `Cancel ${a.driverName}'s link?`, message: "It stops working at once. What they watched and answered stays on record.", confirmLabel: "Cancel link", cancelLabel: "Keep it", tone: "danger" });
  if (!ok) return;
  try {
    await cancel.mutateAsync(a.id);
    toast.success("Link cancelled");
  } catch (e) {
    toast.error("Link not cancelled", e instanceof Error ? e.message : undefined);
  }
}
async function copy(link: string) {
  await navigator.clipboard.writeText(link);
  toast.success("Link copied");
}
</script>

<template>
  <div class="space-y-4">
    <p class="flex flex-wrap gap-2" data-test="progress-counts">
      <AppBadge v-for="k in (['finished', 'in_progress', 'not_opened', 'overdue'] as const)" :key="k" :tone="STANDING[k].tone">{{ counts[k] }} {{ STANDING[k].label.toLowerCase() }}</AppBadge>
    </p>

    <BaseCard v-if="copied" class="flex flex-wrap items-center justify-between gap-3" data-test="progress-copied">
      <span class="text-sm text-ink">New link for {{ copied.driverName }}</span>
      <span class="flex items-center gap-2">
        <code class="max-w-xs truncate font-mono text-xs text-ink-secondary">{{ copied.link }}</code>
        <AppButton size="sm" @click="copy(copied.link)">Copy link</AppButton>
      </span>
    </BaseCard>

    <DataWorkspace>
      <FilterBar v-model:search="search" embedded search-placeholder="Search driver or course…" :count="rows.length" count-label="drivers" :active-count="(search.trim() ? 1 : 0) + (show ? 1 : 0)" @clear-all="qs.set({ search: undefined, status: undefined })">
        <template #filters>
          <FilterSelect v-model="show" label="Status" :options="showOptions" />
        </template>
      </FilterBar>
      <DataTable
        :columns="columns"
        :rows="pageRows"
        embedded
        row-key="id"
        :loading="assignments.isLoading.value"
        :error="assignments.isError.value ? 'Could not load who was sent training.' : null"
        :retrying="assignments.isFetching.value"
        @retry="assignments.refetch()"
      >
        <template #empty><p>{{ all.length ? "Nothing matches these filters." : "No training sent yet. Send it from Send to drivers." }}</p></template>
        <template #cell-driverName="{ row }">
          <span class="block font-medium text-ink">{{ row.driverName }}</span>
          <span v-if="row.recipientPhone" class="flex items-center gap-1.5 text-xs text-ink-tertiary" data-test="progress-outside-roster">
            <AppBadge tone="neutral">Not on the driver list</AppBadge>{{ formatPhone(row.recipientPhone) }}
          </span>
          <span class="block text-xs text-ink-tertiary">{{ row.courseTitle }}</span>
        </template>
        <template #cell-sentAt="{ row }">
          <span class="block text-ink-secondary">{{ formatDateTime(row.sentAt, "—", zone) }}</span>
          <span v-if="row.lastSentVia" class="block text-xs text-ink-tertiary">{{ VIA_LABEL[row.lastSentVia as keyof typeof VIA_LABEL] }}</span>
        </template>
        <template #cell-films="{ row }">
          <ul class="space-y-0.5">
            <li v-for="l in row.lessons" :key="l.lessonId" class="flex items-center gap-2 text-xs">
              <AppBadge :tone="LESSON_STATUS[l.status as keyof typeof LESSON_STATUS].tone">{{ lessonCell(l) }}</AppBadge>
              <span class="text-ink-secondary">{{ l.title }}</span>
            </li>
          </ul>
        </template>
        <template #cell-dueOn="{ value }"><span class="text-ink-secondary tabular-nums">{{ value ?? "—" }}</span></template>
        <template #cell-standing="{ row }">
          <AppBadge :tone="STANDING[row.standing as AssignmentStanding].tone">{{ STANDING[row.standing as AssignmentStanding].label }}</AppBadge>
        </template>
        <template v-if="canManage" #actions="{ row }">
          <KebabMenu v-if="!row.revokedAt && !row.completedAt">
            <AppButton class="kebab-item" @click="doResend(row as TrainingAssignmentRow)">Send a new link</AppButton>
            <AppButton class="kebab-item kebab-item-danger" @click="doCancel(row as TrainingAssignmentRow)">Cancel link…</AppButton>
          </KebabMenu>
        </template>
        <template #footer>
          <TablePagination :page="page" :page-size="PAGE_SIZE" :total="rows.length" :loading="assignments.isFetching.value" @update:page="page = $event" />
        </template>
      </DataTable>
    </DataWorkspace>
  </div>
</template>
