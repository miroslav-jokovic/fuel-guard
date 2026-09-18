<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  HIRING_PHASE_LABELS,
  canWriteDriverLifecycle,
  rolesThatManage,
  type HiringPhase,
} from "@silvicom/shared";
import { AppButton as BaseButton, AppIcon } from "@silvicom/ui";
import KebabMenu from "@/components/KebabMenu.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import ExplainerPanel from "@/components/ui/ExplainerPanel.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable from "@/components/ui/DataTable.vue";
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import {
  applicantDispositionBadge,
  hiringPhaseBadge,
  hiringWaitingOnBadge,
} from "@/lib/badges.recruiting";
import { formatDate } from "@/lib/format";
import { sortRows, toggleSort, type SortState } from "@/lib/sort";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useArchiveDriver } from "@/composables/useDrivers";
import { usePipelineQuery, type PipelineApplicant } from "@/features/recruitment/useEmployment";
import RecruitmentTabs from "@/features/recruitment/RecruitmentTabs.vue";
import HireDrawer from "@/features/recruitment/HireDrawer.vue";
import InviteApplicantDrawer from "@/features/recruitment/InviteApplicantDrawer.vue";
import ArchiveDriverModal from "@/components/ArchiveDriverModal.vue";

/**
 * Hiring — the board (B4, `HIRING-MODULE-PLAN.md` §9, `HIRING-UI-PLAN.md` §4.1).
 *
 * ── WHAT CHANGED AT B4, AND THE ONE SENTENCE IT HAS TO MAKE TRUE ──────────────────────────────
 * *"A recruiter opening Recruitment sees who is waiting on them, first, without choosing a page."*
 * Three things follow from that sentence and each one removed something that was here:
 *
 *   · **The columns answer the recruiter's question rather than describing the file.** Employers,
 *     CMV employers and screening identity were facts ABOUT an applicant; *next action* and
 *     *waiting on* are instructions TO a recruiter. §4.1 calls *next action* the column that makes
 *     this a board rather than a list — and it is the fold's own output, never a second rule.
 *   · **The default view is what is MINE today.** The state filter starts on *waiting on you*,
 *     because that is the question the office asks first. ⚠ A default that hides rows is a real
 *     hazard, so the filter's own label carries its count and *Everyone* carries the total: a
 *     recruiter can always see how many people the view is not showing them.
 *   · **Four stat tiles went.** They counted the seven stages of `applicantPipeline.ts`, which is
 *     the older and narrower answer — it stops where the application does, and the board now goes
 *     to the hire. Two live answers to "what stage" on one screen is D-HM2's disagreement, and the
 *     mockup's board has no tiles.
 *
 * ── WHERE THE OTHER TWO PAGES WENT ────────────────────────────────────────────────────────────
 * Screening readiness and the safety-history inquiry queue are TABS now, not sidebar entries
 * (D-HUI8). They are not deleted, their URLs still work, and `RecruitmentTabs.vue` carries the
 * argument for why the tabs navigate rather than swapping a panel.
 *
 * ── WHAT DID NOT CHANGE ───────────────────────────────────────────────────────────────────────
 * Every stage is still DERIVED, server-side, by a pure function this page could call. There is no
 * stage column to advance and therefore none to forget. The boundary is still D-HIRE2 —
 * Recruitment owns the APPLICANT, DQF owns the DRIVER — so employment history for somebody already
 * hired is on their driver page and not in a second fleet-wide table here.
 */
const router = useRouter();
/**
 * The board, and its other half. Archived applicants leave this list and nothing else (0235) — their
 * row, their draft and anything they signed are untouched, and their own page still opens. The chip
 * is a VIEW rather than a second page, so the columns, the stage computation and the ordering cannot
 * drift between the two.
 */
const showArchived = ref(false);
const pipelineQ = usePipelineQuery(showArchived);

const PAGE_SIZE = 25;
const search = ref("");
const page = ref(1);

/**
 * ⚠ **Every one of these three rests at `""`, and that is not a style choice — `FilterSelect.clear()`
 * emits `""` unconditionally.** A filter whose "show everything" value is `"all"` or `"live"` has no
 * value the ✕ can produce, so pressing it sets a value nothing matches and the table goes blank.
 * Measured on this page on 2026-09-18: with `"all"` the ✕ on Stage emptied the board, and every test
 * passed, because a test that never presses the clear button cannot see it. The two filters that
 * inherited `"all"`/`"live"` from the previous board carried the same defect and are fixed here.
 */
const phase = ref("");

/**
 * The state filter, and it is the board's most important control.
 *
 * ⚠ It OPENS on `us` (§4.1) — the only default in this app that hides rows on arrival, defensible
 * only because the control says so: the option labels carry counts, so the closed trigger reads
 * "Waiting on you (3)" with "Everyone (6)" one click away. Its resting value is `""`, which makes
 * the ✕ mean exactly the right thing here: *clear the "mine" filter and show me everybody.*
 */
const waitingOn = ref("us");

const VIEW_FILTERS = [
  { value: "", label: "Applicants" },
  { value: "archived", label: "Archived" },
];

/** Everything on the board before the state and stage filters — the denominator for every count. */
const all = computed(() => {
  const q = search.value.trim().toLowerCase();
  return (pipelineQ.data.value ?? []).filter((a) => (q ? a.full_name.toLowerCase().includes(q) : true));
});

const countWaiting = (who: "us" | "them") =>
  all.value.filter((a) => a.checklist?.waiting_on === who).length;

/**
 * ⚠ The counts are recomputed from `all` rather than from `rows`, so each option says how many rows
 * SWITCHING to it would show. An option labelled with the count of the view you are already in is
 * the thing that makes a hiding default dangerous.
 */
const WAITING_FILTERS = computed(() => [
  { value: "us", label: `Waiting on you (${countWaiting("us")})` },
  { value: "them", label: `Waiting on them (${countWaiting("them")})` },
  { value: "", label: `Everyone (${all.value.length})` },
]);

/**
 * The stage filter, from the catalogue's phases (B4) rather than from `APPLICANT_STAGES`.
 *
 * ⚠ There is no "Blocked" option, and its absence is a measurement rather than an omission. `next`
 * is the first step that is neither done nor blocked, so a row can only have no next step when
 * everything measurable is done — a blocked step is always preceded by the unmet step blocking it,
 * which is itself unblocked and gets nominated first. A Blocked filter would return zero for ever.
 * Blocked steps are real and belong on the applicant's own checklist, a row at a time (B5).
 */
const PHASE_FILTERS = [
  { value: "", label: "All stages" },
  ...(Object.keys(HIRING_PHASE_LABELS) as HiringPhase[]).map((p) => ({
    value: p,
    label: HIRING_PHASE_LABELS[p],
  })),
];

/**
 * ⚠ Days waiting sorts DESCENDING by default, and that is Q-HUI4's ruling made to work rather than
 * a taste: the board is a table and not a kanban because *"a sortable days-in-stage column answers
 * the only question a kanban would"* — which is **what is going stale**. Opening on the oldest is
 * that question already answered; opening unsorted would leave the reader to discover the control.
 */
const sort = ref<SortState>({ key: "days_waiting", dir: "desc" });

const rows = computed(() => {
  const filtered = all.value
    .filter((a) => waitingOn.value === "" || a.checklist?.waiting_on === waitingOn.value)
    .filter((a) => phase.value === "" || a.checklist?.phase === phase.value);
  // The sortable column lives inside `checklist`, so the accessor reaches into it rather than the
  // row — and an applicant the API answered without one sorts LAST, which is `sortRows`' own rule
  // for "not measured" and the honest place for a row nothing is known about.
  return sortRows(filtered, sort.value, (row, key) =>
    key === "days_waiting" ? (row.checklist?.days_waiting ?? null) : (row as unknown as Record<string, unknown>)[key],
  );
});
const paged = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

/** Landing on page 3 of a list that now has four rows is the bug this watcher exists to prevent. */
watch([search, phase, waitingOn], () => {
  page.value = 1;
});

const columns: DataTableColumn[] = [
  { key: "full_name", label: "Applicant" },
  { key: "stage", label: "Stage" },
  { key: "next", label: "Next action" },
  { key: "waiting_on", label: "Waiting on" },
  { key: "days_waiting", label: "Days waiting", numeric: true, sortable: true },
];

/**
 * ⚠ `application`, not `employment`, since U6 (D-UI7). Clicking a row on the applicant board means
 * "open their application" — it always did, and it said `employment` only because that one tab held
 * the invite card as well as the history. The tab it wanted now has its own name.
 */
function openApplicant(id: string): void {
  // R7: the applicant record is the recruitment surface's own page now, not a tab on the driver
  // page. The old destination still resolves and redirects here, so nobody's bookmark broke.
  void router.push({ name: "applicant-record", params: { id } });
}

/**
 * Hiring is not a recruitment act, and the affordance says so. `drivers.status` starts the
 * §391.51(c) retention clock and decides driver-app access, so 0213 refuses a recruiter's status
 * change in a trigger — offering them a Hire button would be offering an action the database
 * blocks. They see everything else on this board.
 */
const session = useSessionStore();
const canHire = computed(() => canWriteDriverLifecycle(session.role));
const hiring = ref<PipelineApplicant | null>(null);

/**
 * U1/D-UI1 — the act that STARTS an application, on the page named after applicants.
 *
 * It lived only inside a driver's Employment tab, which meant somebody had to be created as a
 * driver under Fleet before they could be invited to become one. Hiring is gated harder (0213
 * refuses a recruiter's status change in a trigger, so `canHire` is `canWriteDriverLifecycle`);
 * inviting is recruitment's own work and takes the section gate.
 */
const canInvite = computed(() => {
  const role = session.role;
  return Boolean(role) && rolesThatManage("recruitment").includes(role!);
});
const inviting = ref(false);

const archiving = ref<PipelineApplicant | null>(null);
const archiveDriver = useArchiveDriver();
const toast = useToastStore();

/**
 * `view` is the chip; `showArchived` is what the query reads. Two refs rather than one because
 * `FilterSelect` speaks strings and the query wants a boolean.
 *
 * ⚠ Switching to Archived also drops the state filter to *Everyone*. An archived applicant is one
 * nobody is working, so almost none of them is waiting on anybody — under the default the Archived
 * view would open empty and read as "there are none", which is a different and wrong statement.
 */
const view = computed({
  get: () => (showArchived.value ? "archived" : ""),
  set: (v: string) => {
    showArchived.value = v === "archived";
    waitingOn.value = showArchived.value ? "" : "us";
    page.value = 1;
  },
});

async function setArchived(applicant: PipelineApplicant, archived: boolean) {
  try {
    await archiveDriver.mutateAsync({ id: applicant.driver_id, archived });
    toast.success(
      archived ? "Archived" : "Restored",
      archived
        ? `${applicant.full_name} is off the board. Nothing they filled in or signed was changed.`
        : `${applicant.full_name} is back on the board.`,
    );
  } catch (e) {
    toast.error(
      archived ? "Could not archive" : "Could not restore",
      e instanceof Error ? e.message : undefined,
    );
  } finally {
    archiving.value = null;
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Everyone you are hiring, and the one thing each of them is waiting on">
      <template #actions>
        <BaseButton v-if="canInvite" variant="primary" @click="inviting = true">
          Invite an applicant
        </BaseButton>
      </template>
    </PageHeader>

    <!-- D-HUI8: one nav entry, three views. `RecruitmentTabs` carries why they navigate. -->
    <RecruitmentTabs />

    <!-- The method, collapsed, so the page never explains itself in front of the work (§4.2). Plain
         words lead and no CFR citation appears on screen (D-UI9) — those live in the printed PDF. -->
    <ExplainerPanel title="How this list is worked out">
      <p>
        Every row is read from the paperwork itself — the forms that have been signed, the records on
        file, the places signed in the application packet. Nothing here is ticked by hand, so this
        list cannot disagree with the driver's own file. A step counts the moment its document
        exists, even when the work was done outside this system.
      </p>
      <p>
        <strong>Days waiting</strong> counts from the last thing that happened, not from the day they
        applied — so somebody invited in March whose drug test came back yesterday reads as one day,
        which is what a recruiter needs to know.
      </p>
    </ExplainerPanel>

    <!-- U5/D-UI3: `DataWorkspace` → `FilterBar embedded` → `DataTable embedded`, contract §5.2b. -->
    <DataWorkspace>
      <FilterBar
        v-model:search="search"
        embedded
        search-placeholder="Search applicants…"
        :count="rows.length"
        count-label="applicants"
      >
        <template #filters>
          <FilterSelect v-model="waitingOn" label="Waiting on" :options="WAITING_FILTERS" />
          <FilterSelect v-model="phase" label="Stage" :options="PHASE_FILTERS" />
          <FilterSelect v-model="view" label="Show" :options="VIEW_FILTERS" />
        </template>
      </FilterBar>
      <DataTable
        embedded
        :columns="columns"
        :rows="paged"
        row-key="driver_id"
        :loading="pipelineQ.isLoading.value"
        :error="pipelineQ.isError.value ? (pipelineQ.error.value?.message ?? 'Could not load the pipeline.') : null"
        :retrying="pipelineQ.isFetching.value"
        :row-class="() => 'cursor-pointer'"
        :sort="sort"
        @sort="(key: string) => (sort = toggleSort(sort, key))"
        @row-click="(row: PipelineApplicant) => openApplicant(row.driver_id)"
      >
        <template #empty>
          <!-- ⚠ TWO empty states, because "nobody has applied" and "nobody is waiting on you" are
               different facts and the second one is good news. Before B4 this page had one, and a
               default filter that hides rows would have made it say the wrong one every morning the
               office was caught up. Fact, then the next action (§4's rule). -->
          <template v-if="all.length && rows.length === 0">
            <p class="text-sm text-ink-muted">
              Nothing is waiting on you. {{ all.length }} {{ all.length === 1 ? "applicant is" : "applicants are" }}
              on the board — switch “Waiting on” to Everyone to see them.
            </p>
            <div class="mt-4">
              <BaseButton @click="waitingOn = ''">Show everyone</BaseButton>
            </div>
          </template>
          <template v-else>
            <p class="text-sm text-ink-muted">
              No applicants yet. Invite one and they fill in their own driver application; hired
              drivers and their qualification files live under Driver Qualification.
            </p>
            <div v-if="canInvite" class="mt-4">
              <BaseButton variant="primary" @click="inviting = true">Invite an applicant</BaseButton>
            </div>
          </template>
        </template>

        <template #cell-full_name="{ row }">
          <span class="font-medium text-ink">{{ row.full_name }}</span>
          <span class="ml-2 text-2xs text-ink-tertiary">invited {{ formatDate(row.applied_on) }}</span>
          <span v-if="showArchived" :class="[BADGE_BASE, toneClass('neutral'), 'ml-2']">Archived</span>
        </template>

        <!--
          ⚠ A decided application shows the DECISION, not its progress. "Screening" beside a decline
          is not extra information, it is a stale sentence about somebody the carrier already
          answered — and it is what would send the next recruiter to chase them. The decision
          supersedes the stage; the row itself stays, because leaving the board is what archiving is
          for (0235) and the two acts are deliberately separate.
        -->
        <template #cell-stage="{ row }">
          <span
            v-if="row.disposition"
            :class="[BADGE_BASE, toneClass(applicantDispositionBadge(row.disposition.outcome).tone)]"
          >
            {{ applicantDispositionBadge(row.disposition.outcome).label }}
          </span>
          <span v-else-if="row.checklist" :class="[BADGE_BASE, toneClass(hiringPhaseBadge(row.checklist.phase).tone)]">
            {{ hiringPhaseBadge(row.checklist.phase).label }}
          </span>
          <span v-else class="text-ink-muted">—</span>
        </template>

        <!-- §4.1: the column that makes this a board rather than a list. The words are the fold's,
             resolved from the step catalogue server-side, so this page never names a step. -->
        <template #cell-next="{ row }">
          <span v-if="row.disposition" class="text-ink-muted">Nothing — this one is closed</span>
          <span v-else-if="row.checklist?.next_label" class="font-medium text-ink">
            {{ row.checklist.next_label }}
          </span>
          <span v-else class="text-ink-muted">Nothing left to do</span>
        </template>

        <!-- ⚠ Icon AND word (D-HUI4), brought into line with the checklist in B5's PR. It was
             word-only from B4 until 2026-09-18; the glyph comes from the same record the checklist
             rows read, so this column and that one cannot say one state two ways. -->
        <template #cell-waiting_on="{ row }">
          <span
            v-if="!row.disposition && row.checklist"
            :class="[BADGE_BASE, toneClass(hiringWaitingOnBadge(row.checklist.waiting_on).tone)]"
          >
            <AppIcon
              :icon="hiringWaitingOnBadge(row.checklist.waiting_on).icon"
              class="size-3.5"
              aria-hidden="true"
            />
            {{ hiringWaitingOnBadge(row.checklist.waiting_on).label }}
          </span>
          <span v-else class="text-ink-muted">—</span>
        </template>

        <template #cell-days_waiting="{ row }">
          <span v-if="row.checklist" class="text-ink-secondary">{{ row.checklist.days_waiting }}</span>
          <span v-else class="text-ink-muted">—</span>
        </template>

        <template #actions="{ row }">
          <KebabMenu v-if="canHire || canInvite">
            <BaseButton v-if="canHire && !showArchived" class="kebab-item" @click="hiring = row">Hire…</BaseButton>
            <BaseButton v-if="canInvite && !showArchived" class="kebab-item" @click="archiving = row">
              Archive…
            </BaseButton>
            <BaseButton v-if="canInvite && showArchived" class="kebab-item" @click="setArchived(row, false)">
              Restore
            </BaseButton>
          </KebabMenu>
        </template>
        <template #footer>
          <TablePagination v-model:page="page" :total="rows.length" :page-size="PAGE_SIZE" />
        </template>
      </DataTable>
    </DataWorkspace>

    <ArchiveDriverModal
      :subject="archiving"
      kind="applicant"
      :busy="archiveDriver.isPending.value"
      @close="archiving = null"
      @confirm="archiving && setArchived(archiving, true)"
    />

    <InviteApplicantDrawer
      :open="inviting"
      @close="inviting = false"
      @created="pipelineQ.refetch()"
    />

    <HireDrawer
      :open="hiring !== null"
      :driver-id="hiring?.driver_id ?? null"
      :full-name="hiring?.full_name ?? ''"
      @close="hiring = null"
    />
  </div>
</template>
