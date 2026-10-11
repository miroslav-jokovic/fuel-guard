<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AppCard as BaseCard, AppButton as BaseButton } from "@silvicom/ui";
import {
  QUEUE_FINDING_KINDS, FINDING_KIND_LABELS,
  FINDING_QUEUE_STATES, FINDING_QUEUE_STATE_LABELS,
  findingAgeDays,
  type FindingKind, type FindingQueueState, type FindingSource,
} from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import StatCard from "@/components/ui/StatCard.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useSpendFilters } from "@/features/reconcile/useSpendFilters";
import { useExceptionTotalsQuery } from "@/features/reconcile/useExceptions";
import { useFindingsQuery, type FindingsQuery } from "@/features/reconcile/useFindings";
import {
  useAssigneesQuery, useAssignFindings, assigneeLabel, sectionsOf,
} from "@/features/reconcile/useFindingAssignment";
import { usd, usd2 } from "@/features/reconcile/format";
import { NO_FIGURE, NO_FIGURE_NOTE, tileReady } from "@/lib/tileFigure";
import { useToastStore } from "@/stores/toast";
import { useSessionStore } from "@/stores/session";
import { useQueryState } from "@/composables/useQueryState";
import { useVehiclesQuery } from "@/composables/useVehicles";
import CaseDrawers from "@/features/anomalies/CaseDrawers.vue";
import ExceptionSlideOver from "@/features/reconcile/ExceptionSlideOver.vue";
import MoneyExportActions from "@/features/reconcile/MoneyExportActions.vue";
import { useProblemDrawer } from "./fuelProblems/useProblemDrawer";

/**
 * Fuel problems (F02-F04 chunk 8c4; the Findings inbox before it, the fuel exception ledger before
 * that) — every card-fraud incident, short fill and money finding the checks made, and what anybody did
 * about it.
 *
 * ── WHY THIS PAGE EXISTS ─────────────────────────────────────────────────────────────────────────
 * The spend page finds money. Until F6 it then forgot it: a discrepancy had no state, no owner and no
 * resolution, so the same one was investigated twice by two people a week apart, a dispute settled
 * with Pilot left no trace it had been raised, and the product could report what it had found and
 * never what it had recovered.
 *
 * ── THREE NUMBERS, NEVER ONE ─────────────────────────────────────────────────────────────────────
 * Can be disputed, disputed and credited back are different figures and the gap between them is the
 * point: "we can claim $14,200" is a claim about the bills; "we got $14,200 back" is a claim about the
 * business, and only the second one renews a contract. Beneath them the KINDS of money stay apart too —
 * recoverable, owed, and unexplained must not be added (D-FX5; the tiles, 9b).
 *
 * ── THE WINDOW IS THE SAME WINDOW ────────────────────────────────────────────────────────────────
 * `useSpendFilters` owns the period here exactly as it does on the spend page, so a figure quoted off
 * one and checked against the other covers the same days. That is the whole reason it is a shared
 * composable and not a local ref.
 */
const toast = useToastStore();
const session = useSessionStore();
const f = useSpendFilters();
const { param } = useQueryState();

/**
 * ── EVERY FILTER ON THIS PAGE IS NOW IN THE URL (FUEL-C3, D-FUI8, finished at P3) ───────────────
 * The window and the trucks always were, through `useSpendFilters`. Status and kind were local `ref`s,
 * so the one view somebody actually forwards — "the open disputes for these two trucks" — could not be
 * sent, and the EXPORT could not honour them either: a file that ignored the status filter would be
 * wider than the list above it, which is the failure that looks like a working download.
 *
 * The defaults are the work queue. They are written as the ABSENCE of the parameter rather than as
 * `?status=open,investigating,disputed`, so a link that says nothing means the queue and a link that
 * says something means exactly what it says.
 */
/**
 * ── THE STATUS FILTER IS NOW THE QUEUE AXIS (C7b, D-FUI7) ───────────────────────────────────────
 * It listed the ledger's six statuses, which cannot describe a theft case: an anomaly is never
 * `disputed` and an exception is never `superseded`. The four shared states can describe both, and
 * `anomalyStatusesIn` / `exceptionStatusesIn` translate each back into its own vocabulary server-side
 * — so nothing here restates a mapping, which is what C7a exists for.
 *
 * ⚠ Old links keep working by accident of vocabulary rather than by design: `?status=open` named a
 * ledger status and `?state=open` names a queue state, so a forwarded link from last week simply
 * falls back to the default queue rather than landing on nothing. The parameter is RENAMED and not
 * reused, because `?status=disputed` and `?state=working` are different questions and quietly
 * reinterpreting one as the other is how a sent link stops meaning what its sender saw.
 */
const DEFAULT_STATES: FindingQueueState[] = ["open", "investigating", "working"];
const stateParam = param("state");
const kindParam = param("kind");
const states = computed<FindingQueueState[]>({
  get: () => {
    const named = stateParam.value.split(",").filter((v): v is FindingQueueState =>
      (FINDING_QUEUE_STATES as readonly string[]).includes(v));
    return named.length ? named : DEFAULT_STATES;
  },
  set: (v) => (stateParam.value = v.length ? v.join(",") : ""),
});
const kinds = computed<FindingKind[]>({
  get: () => kindParam.value.split(",").filter((v): v is FindingKind =>
    (QUEUE_FINDING_KINDS as readonly string[]).includes(v)),
  set: (v) => (kindParam.value = v.length ? v.join(",") : ""),
});

/**
 * "Assigned to me", and deliberately nothing more.
 *
 * The API has always accepted `assignedTo` and nothing ever sent it (A3's sibling). A full owner
 * PICKER would need a member directory, and `/api/members` is `requireRole("admin")` — so building one
 * would have put a control on this page that works for one role and reads as broken for the accountant
 * and the dispatcher who live in this ledger. That is the "component placed where the permission check
 * happens to pass" shape CLAUDE.md names, and the blocker is written into the plan (Q-FUI4) rather than
 * routed around. `mine` needs no directory: it is the caller's own id.
 */
const mine = param("owner", ["me"]);
const assignedTo = computed(() => (mine.value === "me" ? (session.userId ?? null) : null));

const page = ref(1);
const PAGE_SIZE = 25;

/** One tone per queue state. Closed is quiet; the vendor-dispute state is the one with a clock on it. */
const findingStateTone = (state: string): string =>
  state === "closed" ? "neutral" : state === "working" ? "warning" : state === "investigating" ? "info" : "danger";

const stateOptions = FINDING_QUEUE_STATES.map((v) => ({ value: v, label: FINDING_QUEUE_STATE_LABELS[v] }));
// The queue's kinds only (9b): the buying habits are on Fuel Costs, and a filter offering them would find nothing.
const kindOptions = QUEUE_FINDING_KINDS.map((v) => ({ value: v, label: FINDING_KIND_LABELS[v] }));

const query = computed<FindingsQuery>(() => ({
  states: states.value, kinds: kinds.value,
  vehicleIds: f.vehicleIds.value, assignedTo: assignedTo.value,
  from: f.from.value, to: f.to.value,
  page: page.value, pageSize: PAGE_SIZE,
}));
// Narrowing while on page nine of the old result set lands on an empty page that looks like an error.
watch(
  [states, kinds, () => f.from.value, () => f.to.value, () => f.vehicleIds.value, assignedTo],
  () => { page.value = 1; },
  { deep: true },
);

const { data, isLoading, isError, error } = useFindingsQuery(query);
const rows = computed(() => data.value?.rows ?? []);
const total = computed(() => data.value?.total ?? 0);
/** A source hit the server's read cap. Said out loud — a queue missing rows silently is the worse bug. */
const truncated = computed(() => data.value?.truncated === true);

const window = computed(() => ({
  from: f.from.value, to: f.to.value,
  vehicleIds: f.vehicleIds.value, assignedTo: assignedTo.value,
}));
const totalsQuery = useExceptionTotalsQuery(window);
const totals = totalsQuery.data;

/**
 * ── THREE TILES, THE CLAIM FROM OPEN TO PAID (F02-F04 chunk 9b) ─────────────────────────────────
 * Can be disputed / Disputed / Credited back, from `disputeTotals` in shared. They replaced Identified /
 * Claimed / Recovered / Still open when the buying habits left the queue (Q-F2): what is left is billing
 * work with Pilot. They count money findings only — a case or an incident closes with a verdict, never
 * money (D-FUI7) — and "Can be disputed" adds only the money the fleet can claim (D-FX5), so its sub-line
 * says how many items it counts and how many of them carry a claim.
 *
 * A dash and "Not available" while the figures load or fail, never $0: a zero is a claim about the fleet
 * (11c, N9). The previous window's figures, kept on screen while a new one loads, count as not available
 * — they would sit under a filter bar naming a different window (`lib/tileFigure.ts`).
 */
const tiles = computed(() => {
  const ready = tileReady({ data: totals.value, isError: totalsQuery.isError.value, isPlaceholderData: totalsQuery.isPlaceholderData.value });
  const t = ready ? totals.value : null;
  const items = (n: number) => `${n} item${n === 1 ? "" : "s"}`;
  const tile = (label: string, amount: number | undefined, sub: string, tone?: string) =>
    t ? { label, value: usd2(amount), sub, tone } : { label, value: NO_FIGURE, sub: NO_FIGURE_NOTE, tone };
  return [
    tile("Can be disputed", t?.canDispute.amount, t ? `${items(t.canDispute.count)} open · ${t.canDispute.claims} with money to claim` : ""),
    tile("Disputed", t?.disputed.amount, t ? `${items(t.disputed.count)} with Pilot` : ""),
    tile("Credited back", t?.creditedBack.amount, t ? `${items(t.creditedBack.count)} credited` : "", "text-success-700"),
  ];
});

/**
 * Bulk selection, for the one bulk act this inbox offers (C7b merge 3).
 *
 * ⚠ Assignment and NOT closing, and that is a decision rather than a scope cut. Bulk-closing a queue
 * whose post-ruling precision nobody has measured would manufacture ground truth for the accuracy
 * programme out of one careless click — 82 cases dispositioned in a gesture, feeding the very figure
 * C7 is gated on. Assigning forty findings to somebody is reversible and decides nothing.
 */
const picked = ref<Set<string>>(new Set());
const pickedRows = computed(() => rows.value.filter((r) => picked.value.has(r.id)));
/** Clearing on any filter change: a selection that survives a narrowing acts on rows nobody can see. */
watch([states, kinds, () => f.from.value, () => f.to.value, () => f.vehicleIds.value, page], () => {
  picked.value = new Set();
});

/**
 * Which candidate list to offer. A selection spanning both sections needs somebody who can close
 * BOTH — the API enforces that, and asking for one section's list here would offer names it refuses.
 */
const pickedSections = computed(() => sectionsOf(pickedRows.value));
const assigneeSection = computed(() => (pickedSections.value.length === 1 ? pickedSections.value[0]! : null));
const { data: assignees } = useAssigneesQuery(assigneeSection);
const assignMutation = useAssignFindings();

const assigneeOptions = computed(() => (assignees.value ?? []).map((a) => ({ value: a.id, label: assigneeLabel(a) })));

async function assignPicked(assignee: string | null): Promise<void> {
  const findings = pickedRows.value.map((r) => ({ source: r.source, id: r.id }));
  if (findings.length === 0) return;
  try {
    const r = await assignMutation.mutateAsync({ assignee, findings });
    toast.success(`${r?.assigned ?? findings.length} finding(s) assigned`);
    picked.value = new Set();
  } catch (e) {
    // The API refuses the WHOLE batch and says why — surfaced verbatim, because "narrow the selection
    // to the ones you work" is an instruction and paraphrasing it would lose the instruction.
    toast.error("Could not assign", e instanceof Error ? e.message : undefined);
  }
}

const now = new Date();
const tableRows = computed(() =>
  rows.value.map((r) => ({
    id: r.id,
    source: r.source,
    date: r.occurredOn ?? "—",
    kind: FINDING_KIND_LABELS[r.kind],
    summary: r.summary,
    unit: r.unitNumber ?? "—",
    // ⚠ An em dash and not $0.00. A theft case has no amount, and a zero in a money column is a
    // figure — one somebody would reasonably add to the column above it.
    amount: r.amountUsd == null ? "—" : usd(r.amountUsd),
    amountTone: r.amountUsd == null ? "text-ink-tertiary" : "text-ink",
    age: findingAgeDays(r, now),
    state: r.queueState,
  })),
);
const columns: DataTableColumn[] = [
  { key: "date", label: "Date", width: "sm", cellClass: "text-ink-secondary" },
  { key: "kind", label: "Finding", width: "sm" },
  { key: "summary", label: "What happened", width: "lg", cellClass: "text-ink-secondary" },
  { key: "unit", label: "Unit", width: "xs", cellClass: "text-ink-secondary" },
  { key: "amount", label: "Amount", numeric: true, width: "sm" },
  // Aging is what makes an unclaimed finding visible, which is the whole accountability story the
  // Q-FUI4 ruling chose instead of a default assignee.
  { key: "age", label: "Age", numeric: true, width: "xs" },
  { key: "state", label: "Status", width: "sm" },
];

/**
 * Every kind opens its own drawer on this page (8c3), each with its own close (D-FUI7): a money finding
 * the ledger drawer, a fill case or an incident `CaseDrawers`. Named in the URL since 8c4.
 */
const drawer = useProblemDrawer();
const unitOfRow = (id: string | null) => rows.value.find((r) => r.id === id)?.unitNumber ?? "—";
const openFinding = (row: Record<string, unknown>): void => drawer.open(row.source as FindingSource, String(row.id));

/** The money findings currently on screen — what the export and the packet actually cover. */
const moneyIds = computed(() => rows.value.filter((r) => r.source === "exception").map((r) => r.id));

/** The fleet, for the truck filter. Unit numbers on the menu, vehicle ids in the URL — this section's
 *  one truck vocabulary, resolved to the ledger's own `unit_number` by the API. */
const { data: vehicles } = useVehiclesQuery();
const truckOptions = computed(() =>
  [...(vehicles.value ?? [])]
    .sort((a, b) => a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true }))
    .map((v) => ({ value: v.id, label: v.unit_number })),
);

</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Card fraud, short fills and billing findings from the fuel checks: how old each is, who has it, and what was done." />

    <!-- Can be disputed, disputed and credited back are three different claims. The gap between the first
         and the last is the only measure of whether this product is worth its subscription. -->
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <StatCard v-for="t in tiles" :key="t.label" :label="t.label" :value="t.value" :sub="t.sub" :value-tone="t.tone" />
    </div>

    <FilterBar :count="total" count-label="problems">
      <template #filters>
        <DateRangeFilter v-model:from="f.from.value" v-model:to="f.to.value" label="Dates" />
        <FilterSelect v-model="states" :options="stateOptions" label="Status" multiple />
        <FilterSelect v-model="kinds" :options="kindOptions" label="Finding" multiple />
        <FilterSelect v-model="f.vehicleIds.value" :options="truckOptions" label="Unit" multiple />
        <FilterSelect
          v-model="mine"
          label="Owner"
          :options="[
            { value: '', label: 'Anyone' },
            { value: 'me', label: 'Assigned to me' },
          ]"
        />
      </template>
      <template #actions>
        <MoneyExportActions
          :states="states"
          :kinds="kinds"
          :vehicle-ids="f.vehicleIds.value"
          :assigned-to="assignedTo"
          :from="f.from.value"
          :to="f.to.value"
          :money-ids="moneyIds"
        />
      </template>
    </FilterBar>

    <!-- A queue that is missing rows and does not say so is worse than one that refuses to load. -->
    <p v-if="truncated" class="rounded-surface bg-warning-50 px-4 py-3 text-sm text-warning-700 ring-1 ring-warning-100">
      There are more problems than this page can hold at once. Narrow the window or the trucks to be sure you are
      seeing all of them.
    </p>

    <!--
      The bulk bar appears only with a selection, and says what it can act on. A mixed selection
      offers no picker: the two sections have different people who can close them, and the API refuses
      an assignee who cannot close every finding in the batch — so offering a name it would reject is
      a control that exists to produce an error message.
    -->
    <div
      v-if="picked.size"
      class="flex flex-wrap items-center gap-3 rounded-surface bg-surface-muted px-4 py-3 ring-1 ring-edge"
    >
      <span class="text-sm font-medium text-ink">{{ picked.size }} selected</span>
      <template v-if="assigneeSection">
        <FilterSelect
          :model-value="''"
          :options="assigneeOptions"
          label="Assign to"
          @update:model-value="assignPicked(String($event) || null)"
        />
        <BaseButton variant="secondary" :disabled="assignMutation.isPending.value" @click="assignPicked(null)">
          Unassign
        </BaseButton>
      </template>
      <span v-else class="text-sm text-ink-muted">
        This selection spans money findings and theft cases, which different people close. Narrow it to one kind to
        assign it.
      </span>
      <BaseButton variant="ghost" @click="picked = new Set()">Clear</BaseButton>
    </div>

    <p v-if="isError" class="rounded-surface bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-100">
      Couldn't load fuel problems: {{ error instanceof Error ? error.message : "unknown error" }}
    </p>

    <BaseCard v-else padding="none">
      <DataTable
        :columns="columns"
        :rows="tableRows"
        row-key="id"
        selectable
        :selected="picked"
        :loading="isLoading"
        empty-text="Nothing outstanding in this window."
        @update:selected="picked = $event"
        @row-click="openFinding($event)"
      >
        <template #cell-age="{ row }">
          <span class="tabular-nums" :class="Number(row.age) >= 30 ? 'text-warning-600' : 'text-ink-secondary'">
            {{ row.age === null ? "—" : `${row.age}d` }}
          </span>
        </template>
        <template #cell-amount="{ row }">
          <span class="tabular-nums font-medium" :class="String(row.amountTone)">{{ row.amount }}</span>
        </template>
        <template #cell-state="{ row }">
          <span :class="[BADGE_BASE, toneClass(findingStateTone(String(row.state)))]">
            {{ FINDING_QUEUE_STATE_LABELS[row.state as FindingQueueState] }}
          </span>
        </template>
        <template #footer>
          <TablePagination :page="page" :page-size="PAGE_SIZE" :total="total" @update:page="page = $event" />
        </template>
      </DataTable>
    </BaseCard>

    <ExceptionSlideOver :id="drawer.findingId.value" @close="drawer.close" />
    <CaseDrawers
      :case-id="drawer.caseId.value"
      :incident-id="drawer.incidentId.value"
      :unit-of="unitOfRow"
      @close="drawer.close"
    />
  </div>
</template>
