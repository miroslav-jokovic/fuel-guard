<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { AppButton as BaseButton, DataTable, DataWorkspace, FilterBar, TablePagination, useQueryState, type DataTableColumn } from "@silvicom/ui";
import { LEAD_STATUSES, LEAD_STATUS_LABELS, leadChannelLabel, type LeadQueueRow } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { leadMatchBadge, leadStatusTone } from "@/lib/badges.recruiting";
import { formatDateTime, formatPhone } from "@/lib/format";
import AddLeadDrawer from "@/features/recruitment/AddLeadDrawer.vue";
import LeadDrawer from "@/features/recruitment/LeadDrawer.vue";
import RecruitmentTabs from "@/features/recruitment/RecruitmentTabs.vue";
import { LEADS_CLOSED, LEADS_EVERYONE, LEADS_MINE, LEADS_OPEN, LEADS_PAGE_SIZE, useLeadQueueQuery } from "@/features/recruitment/useLeads";
import { useSessionStore } from "@/stores/session";

/**
 * The lead queue (E4b): people who answered an ad or were typed in, one person per row, newest first.
 *
 * Working a lead happens in its drawer (`LeadDrawer.vue`); adding one by hand is `AddLeadDrawer.vue`.
 *
 * It lives under `recruitment`, not `ads`, because the section, its doors and its people are recruitment's
 * (the workflow's Phase E line said `features/ads/`; corrected with this page).
 *
 * The filter and the open lead are in the URL, so a notification's `?lead=` opens the drawer. The page number
 * is not: page N needs the N − 1 cursors before it, which live in memory (`AssignmentHistory.vue`'s reason).
 * There is no search, because the api has none and a search of the loaded page would say "no match" for a
 * person one page further on.
 */
const route = useRoute();
const qs = useQueryState();
const statusOptions = [
  { value: LEADS_OPEN, label: "Open" },
  // LQ5c: both closed statuses at once, so a recruiter can review what the calls settled and reopen if need be.
  { value: LEADS_CLOSED, label: "Closed" },
  ...LEAD_STATUSES.map((s) => ({ value: s as string, label: LEAD_STATUS_LABELS[s] })),
];
const show = qs.param("show", statusOptions.map((o) => o.value), LEADS_OPEN);
// LQ2c: a recruiter's own leads (each new ad lead for an opening they own is theirs, LQ2b), in the URL like "show".
const whoseOptions = [{ value: LEADS_EVERYONE, label: "Everyone's" }, { value: LEADS_MINE, label: "Mine" }];
const whose = qs.param("whose", whoseOptions.map((o) => o.value), LEADS_EVERYONE);
const openLead = qs.param("lead");
const openLeadId = computed(() => openLead.value ?? "");

const session = useSessionStore();
const adding = ref(false);
function added(leadId: string): void {
  adding.value = false;
  openLead.value = leadId;
}

const query = useLeadQueueQuery(show, whose);
const page = ref(1);
watch([show, whose], () => (page.value = 1));
const fetchedPages = computed(() => query.data.value?.pages.length ?? 0);
const pageRows = computed<LeadQueueRow[]>(() => query.data.value?.pages[page.value - 1]?.leads ?? []);
/**
 * LQ6 (Q-AD63 (a)): a lead whose own form answer fails a hard requirement sits in its own lane under the list,
 * collapsed — still here, still openable, still convertible, never hidden; it just does not compete with the leads
 * a recruiter should call first. The split reads the same `summary.hardUnmet` the badge and the bells read; on the
 * Closed view a close for a requirement is the point, so nothing is split there.
 */
const splitByAnswer = computed(() => show.value !== LEADS_CLOSED && show.value !== "not_qualified");
const qualifyingRows = computed(() => (splitByAnswer.value ? pageRows.value.filter((r) => !(r.summary && r.summary.hardUnmet > 0)) : pageRows.value));
const disqualifiedRows = computed(() => (splitByAnswer.value ? pageRows.value.filter((r) => r.summary !== null && r.summary.hardUnmet > 0) : []));
const hasNext = computed(() => page.value < fetchedPages.value || query.hasNextPage.value);
async function goTo(n: number): Promise<void> {
  if (n > fetchedPages.value) {
    if (!query.hasNextPage.value) return;
    await query.fetchNextPage();
    if (n > fetchedPages.value) return;
  }
  page.value = n;
}

const activeFilterCount = computed(() => (show.value !== LEADS_OPEN ? 1 : 0) + (whose.value !== LEADS_EVERYONE ? 1 : 0));
const emptyText = computed(() =>
  whose.value === LEADS_MINE
    ? "No leads of yours here. A new ad lead is yours when its opening names you as its recruiter."
    : show.value === LEADS_OPEN
    ? "No open leads. New ones appear here as they come in."
    : show.value === LEADS_CLOSED
    ? "No closed leads. A lead closes when a recruiter records what the call settled."
    : `No leads marked ${LEAD_STATUS_LABELS[show.value as LeadQueueRow["status"]].toLowerCase()}.`,
);

const columns: DataTableColumn[] = [
  { key: "person", label: "Person" },
  { key: "source", label: "Source" },
  { key: "match", label: "Match" },
  { key: "status", label: "Status" },
  { key: "received", label: "Received" },
];
const linkTo = (id: string) => ({ query: { ...route.query, lead: id } });
// A queue row cannot tell a purged lead from a form whose details all failed to read, so this says what is true of
// both. The drawer reads `purged_at` and can say which.
const personName = (row: LeadQueueRow) => row.full_name ?? (row.phone_e164 || row.email_lower ? "No name given" : "No details on file");
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="People who answered an ad or were added by hand, before they become applicants">
      <template v-if="session.can('recruitment')" #actions>
        <BaseButton variant="primary" data-test="add-lead" @click="adding = true">Add a lead</BaseButton>
      </template>
    </PageHeader>
    <RecruitmentTabs />

    <DataWorkspace>
      <FilterBar embedded :active-count="activeFilterCount" @clear-all="qs.set({ show: undefined, whose: undefined })">
        <template #filters>
          <FilterSelect v-model="show" label="Show" :options="statusOptions" />
          <FilterSelect v-model="whose" label="Whose" :options="whoseOptions" data-test="leads-whose" />
        </template>
      </FilterBar>
      <DataTable
        :columns="columns"
        :rows="qualifyingRows"
        embedded
        row-key="id"
        :loading="query.isLoading.value"
        :error="query.isError.value ? 'Could not load the leads.' : null"
        :retrying="query.isFetching.value"
        :empty-text="disqualifiedRows.length > 0 ? 'Every lead on this page said they miss a requirement — see below.' : emptyText"
      >
        <template #cell-person="{ row }">
          <RouterLink :to="linkTo(row.id)" class="font-medium text-ink hover:underline">{{ personName(row) }}</RouterLink>
          <p class="text-xs text-ink-muted">{{ row.phone_e164 ? formatPhone(row.phone_e164) : row.email_lower }}</p>
        </template>
        <template #cell-source="{ row }">
          {{ leadChannelLabel(row.channel) }}
          <p v-if="row.also.length > 0" class="text-xs text-ink-muted">+{{ row.also.length }} more from this person</p>
        </template>
        <template #cell-match="{ row }">
          <span :class="[BADGE_BASE, toneClass(leadMatchBadge(row.summary).tone)]">{{ leadMatchBadge(row.summary).label }}</span>
        </template>
        <template #cell-status="{ row }">
          <span :class="[BADGE_BASE, leadStatusTone(row.status)]">{{ LEAD_STATUS_LABELS[row.status] }}</span>
          <span v-if="row.do_not_contact" :class="[BADGE_BASE, toneClass('danger'), 'ml-2']">Do not contact</span>
        </template>
        <template #cell-received="{ row }">{{ formatDateTime(row.received_at) }}</template>
        <template #footer>
          <TablePagination
            v-if="pageRows.length > 0 || page > 1"
            :page="page"
            :page-size="LEADS_PAGE_SIZE"
            :total="null"
            :has-next="hasNext"
            :page-rows="pageRows.length"
            :loading="query.isFetching.value"
            @update:page="goTo"
          />
        </template>
      </DataTable>
      <details v-if="disqualifiedRows.length > 0" class="border-t border-edge px-4 py-3" data-test="disqualified-lane">
        <summary class="cursor-pointer text-sm font-medium text-ink">
          Does not qualify by their own answer
          <span class="text-ink-muted">({{ disqualifiedRows.length }} on this page)</span>
          <span class="ml-2 text-xs font-normal text-ink-muted">Not rung, not on the first-call clock. Still here to call, close or make an applicant.</span>
        </summary>
        <!-- ui-adoption: never-empty — the lane renders only when the page has such rows (v-if above). -->
        <!-- ui-adoption: unpaged — a slice of the page the table above already pages; its pagination is theirs. -->
        <DataTable :columns="columns" :rows="disqualifiedRows" embedded row-key="id" class="mt-2">
          <template #cell-person="{ row }">
            <RouterLink :to="linkTo(row.id)" class="font-medium text-ink hover:underline">{{ personName(row) }}</RouterLink>
            <p class="text-xs text-ink-muted">{{ row.phone_e164 ? formatPhone(row.phone_e164) : row.email_lower }}</p>
          </template>
          <template #cell-source="{ row }">{{ leadChannelLabel(row.channel) }}</template>
          <template #cell-match="{ row }">
            <span :class="[BADGE_BASE, toneClass(leadMatchBadge(row.summary).tone)]">{{ leadMatchBadge(row.summary).label }}</span>
          </template>
          <template #cell-status="{ row }">
            <span :class="[BADGE_BASE, leadStatusTone(row.status)]">{{ LEAD_STATUS_LABELS[row.status] }}</span>
          </template>
          <template #cell-received="{ row }">{{ formatDateTime(row.received_at) }}</template>
        </DataTable>
      </details>
    </DataWorkspace>

    <LeadDrawer :lead-id="openLeadId" @close="openLead = ''" />
    <AddLeadDrawer :open="adding" @close="adding = false" @added="added" />
  </div>
</template>
