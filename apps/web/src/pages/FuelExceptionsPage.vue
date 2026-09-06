<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AppCard as BaseCard, AppButton as BaseButton } from "@silvicom/ui";
import {
  FINDING_KINDS, FINDING_KIND_LABELS,
  FINDING_QUEUE_STATES, FINDING_QUEUE_STATE_LABELS,
  findingAgeDays, exceptionStatusesIn, CASE_RULE_ID,
  type FindingKind, type FindingQueueState, type FuelExceptionKind,
} from "@silvicom/shared";
import { useRouter } from "vue-router";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import StatCard from "@/components/ui/StatCard.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import ExceptionSlideOver from "@/features/reconcile/ExceptionSlideOver.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useSpendFilters } from "@/features/reconcile/useSpendFilters";
import { useExceptionTotalsQuery, exceptionExportQuery, type ExceptionQuery } from "@/features/reconcile/useExceptions";
import { useFindingsQuery, type FindingsQuery } from "@/features/reconcile/useFindings";
import {
  useAssigneesQuery, useAssignFindings, assigneeLabel, sectionsOf,
} from "@/features/reconcile/useFindingAssignment";
import { usd } from "@/features/reconcile/format";
import { apiDownload } from "@/lib/api";
import { useToastStore } from "@/stores/toast";
import { useSessionStore } from "@/stores/session";
import { useQueryState } from "@/composables/useQueryState";
import { useVehiclesQuery } from "@/composables/useVehicles";
import ExportButton from "@/components/ExportButton.vue";

/**
 * The fuel exception ledger — every finding the detectors made, and what anybody did about it.
 *
 * ── WHY THIS PAGE EXISTS ─────────────────────────────────────────────────────────────────────────
 * The spend page finds money. Until F6 it then forgot it: a discrepancy had no state, no owner and no
 * resolution, so the same one was investigated twice by two people a week apart, a dispute settled
 * with Pilot left no trace it had been raised, and the product could report what it had found and
 * never what it had recovered.
 *
 * ── THREE NUMBERS, NEVER ONE ─────────────────────────────────────────────────────────────────────
 * Identified, claimed and recovered are different figures and the gap between them is the point.
 * "We found $14,200" is a claim about the software; "we recovered $14,200" is a claim about the
 * business, and only the second one renews a contract. Beneath them the four KINDS of money stay
 * apart too — recoverable, owed, and unexplained must not be added (D-FX5).
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
    (FINDING_KINDS as readonly string[]).includes(v)),
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
const kindOptions = FINDING_KINDS.map((v) => ({ value: v, label: FINDING_KIND_LABELS[v] }));

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
const { data: totals } = useExceptionTotalsQuery(window);

/**
 * ⚠ THESE FOUR TILES COUNT MONEY FINDINGS ONLY, AND NOW SAY SO.
 *
 * They read `exceptionTotals`, which reads `fuel_exceptions` — and that is CORRECT and must stay
 * correct: D-FUI7's whole point is that an anomaly closes with a disposition and never with money, so
 * a theft case has no amount to add and a confirmed one is a true finding that recovered nothing.
 *
 * What changed is the context. Before C7b the list beneath these tiles was the same population they
 * counted; now it holds theft cases too, and "Identified $11,368 · 77 findings" sitting above a list
 * of 158 rows reads as a total of what is on screen. It is not one. The sub-labels carry the scope so
 * the arithmetic a reader does in their head is the arithmetic the tiles actually did.
 */
const tiles = computed(() => {
  const t = totals.value;
  return [
    { label: "Identified", value: usd(t?.identified ?? 0), sub: `${t?.lines ?? 0} money findings` },
    { label: "Claimed", value: usd(t?.claimed ?? 0), sub: "taken to the vendor" },
    { label: "Recovered", value: usd(t?.recovered ?? 0), sub: "credited back", tone: "text-success-700" },
    { label: "Still open", value: String(t?.openLines ?? 0), sub: "money findings only" },
  ];
});

const selected = ref<string | null>(null);

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
 * Opening a finding, which is per SOURCE because the two have different detail surfaces.
 *
 * D-FUI7 unifies the queue axis and leaves each source its own close affordance; this is that, one
 * layer up. A money finding opens the ledger drawer it always had. A theft case has no detail ROUTE
 * to open — `/anomalies` is a list and there is no `/anomalies/:id` — so it hands the reader to the
 * page that can work it rather than opening an empty drawer or, worse, the wrong one.
 */
const router = useRouter();
function openFinding(row: Record<string, unknown>): void {
  if (row.source === "exception") { selected.value = String(row.id); return; }
  void router.push({ path: "/anomalies", query: { case: String(row.id) } });
}

/**
 * FUEL-P2/P3 — the file, rendered on the server over the WHOLE filtered set.
 *
 * ⚠ This button used to serialise `rows.value`: the 25 rows on the current page. A controller
 * assembling a claim got page one of a filtered ledger with nothing saying so, while the four tiles
 * above it reported the whole window's money. A smaller export is one thing; an export that disagrees
 * with the tiles above the button it came from is another.
 */
/**
 * The file, and what it can honestly contain.
 *
 * ⚠ `exceptions/export.csv` renders on the server from `fuel_exceptions` — the MONEY findings. Since
 * C7b the list above it also holds theft cases, so an export button that said nothing would produce a
 * file narrower than the list it sits under, which is the failure this page's own header calls "the
 * one that looks like a working download". Two things follow: the query is translated into the
 * ledger's own vocabulary so the file is exactly the money subset of what is on screen, and the scope
 * line says so in words.
 *
 * A theft case has no row in a dispute packet either — it is an accusation about a person, not a line
 * to bill back — so the same scoping covers the packet below.
 */
const ledgerQuery = computed<ExceptionQuery>(() => ({
  // Translated through C7a rather than restated: the axis maps back into each source's vocabulary.
  status: [...new Set(states.value.flatMap((st) => exceptionStatusesIn(st)))],
  kind: kinds.value.filter((k): k is FuelExceptionKind => k !== CASE_RULE_ID),
  vehicleIds: f.vehicleIds.value,
  assignedTo: assignedTo.value,
  from: f.from.value,
  to: f.to.value,
  page: 1,
  pageSize: PAGE_SIZE,
}));

/** The money findings currently on screen — what the export and the packet actually cover. */
const moneyRows = computed(() => rows.value.filter((r) => r.source === "exception"));

const exportTarget = computed(() => ({
  href: `/api/fueling/exceptions/export.csv?${exceptionExportQuery(ledgerQuery.value)}`,
  filename: `fuel-findings-${f.from.value}-to-${f.to.value}.csv`,
  scope: `${f.from.value} → ${f.to.value} · ${f.vehicleIds.value.length === 0 ? "all trucks" : `${f.vehicleIds.value.length} truck${f.vehicleIds.value.length === 1 ? "" : "s"}`} · money findings only`,
}));

/** The fleet, for the truck filter. Unit numbers on the menu, vehicle ids in the URL — this section's
 *  one truck vocabulary, resolved to the ledger's own `unit_number` by the API. */
const { data: vehicles } = useVehiclesQuery();
const truckOptions = computed(() =>
  [...(vehicles.value ?? [])]
    .sort((a, b) => a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true }))
    .map((v) => ({ value: v.id, label: v.unit_number })),
);

const packetBusy = ref(false);
/**
 * The document you send Pilot. Rendered on the server from the persisted runs, not from whatever this
 * screen is showing — a figure in a dispute packet gets quoted back months later, so it comes from the
 * same records the finding was written from.
 */
async function downloadPacket() {
  if (packetBusy.value || moneyRows.value.length === 0) return;
  packetBusy.value = true;
  try {
    const ids = moneyRows.value.map((r) => r.id).join(",");
    await apiDownload(`/api/fueling/exceptions/packet.pdf?ids=${ids}`, `fuel-dispute-packet-${f.from.value}.pdf`);
  } catch (e) {
    toast.error("Could not build the packet", e instanceof Error ? e.message : undefined);
  } finally {
    packetBusy.value = false;
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Every finding the fuel and safety checks made, how old it is, and what anybody did about it." />

    <!-- Identified, claimed and recovered are three different claims. The gap between the first and
         the last is the only measure of whether this product is worth its subscription. -->
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard v-for="t in tiles" :key="t.label" :label="t.label" :value="t.value" :sub="t.sub" :value-tone="t.tone" />
    </div>

    <FilterBar :count="total" count-label="findings">
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
        <ExportButton
          :href="exportTarget.href"
          :filename="exportTarget.filename"
          :scope="exportTarget.scope"
          :disabled="!moneyRows.length"
        />
        <BaseButton variant="secondary" :disabled="!moneyRows.length || packetBusy" @click="downloadPacket">
          {{ packetBusy ? "Building…" : "Dispute packet" }}
        </BaseButton>
      </template>
    </FilterBar>

    <!-- A queue that is missing rows and does not say so is worse than one that refuses to load. -->
    <p v-if="truncated" class="rounded-surface bg-warning-50 px-4 py-3 text-sm text-warning-700 ring-1 ring-warning-100">
      There are more findings than this page can hold at once. Narrow the window or the trucks to be sure you are
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
      Couldn't load the ledger: {{ error instanceof Error ? error.message : "unknown error" }}
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

    <ExceptionSlideOver :id="selected" @close="selected = null" />
  </div>
</template>
