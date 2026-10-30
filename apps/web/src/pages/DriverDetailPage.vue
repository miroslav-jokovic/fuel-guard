<script setup lang="ts">
import { afterReset, useDetectionEpoch } from "@/features/anomalies/useDetectionEpoch";
import { computed, nextTick, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import type { ChartConfiguration } from "chart.js";
import {
  computeSubjectMpg,
  dispatchHoldNotice,
  plausibleFillMpg,
  type Anomaly,
  type FuelTransaction,
} from "@silvicom/shared";
import { supabase } from "@/lib/supabase";
import { stationDate } from "@/lib/stationTime";
import BaseChart from "@/components/BaseChart.vue";
import StatusBadge from "@/components/StatusBadge.vue";
import {
  AppCallout,
  AppCard as BaseCard,
  AppTabs,
  type TabItem,
  DataTable,
  type DataTableColumn,
  FactList,
  type Fact,
  QueryState,
  isNotFound,
} from "@silvicom/ui";
import {
  DRIVER_PAGE_SECTIONS,
  relocatedSectionPath,
  resolveDriverSection,
  type DriverSection,
} from "./driverSections";
import { viz, areaFill } from "@/lib/chartTheme";
import PageHeader from "@/components/ui/PageHeader.vue";
import ExportButton from "@/components/ExportButton.vue";
import QualificationSection from "@/features/compliance/QualificationSection.vue";
import SevenDayStatementSection from "@/features/roster/SevenDayStatementSection.vue";
import DriverContactSection from "@/features/roster/DriverContactSection.vue";
import HolderEquipmentCard from "@/features/inventory/HolderEquipmentCard.vue";
import { useDriverQuery } from "@/composables/useDrivers";
import { useDispatchHoldQuery } from "@/composables/useCompliance";
import { formatDate } from "@/lib/format";
import { useRequestBinder } from "@/composables/useDqExports";
import { useToastStore } from "@/stores/toast";
import { useSessionStore } from "@/stores/session";

const route = useRoute();
const router = useRouter();
const id = computed(() => String(route.params.id ?? ""));

/**
 * One driver, one page (DQF plan D1): the qualification file stops being a separate destination and
 * becomes a section here, beside the fuel history it was always one click away from needing. The
 * section rides the `?section=` query so /compliance/:id can REDIRECT here without breaking a
 * bookmark or a binder deep link (D2).
 *
 * ── THE EMPLOYMENT TAB WAS FOUR REGULATIONS UNDER ONE NOUN (U6, D-UI7) ────────────────────────
 * It stacked `ApplicationInviteCard` + `EmploymentHistorySection` + `EmployerInquirySection` +
 * `PspRecordsSection` on one scroll — roughly a thousand lines of UI spanning §391.21's application,
 * §391.21(b)(10)'s history, §391.23's investigation and a PSP vendor ledger, under a tab labelled
 * "Employment". Each placement was individually argued and sound pairwise; nobody scoped the sum.
 *
 * The cut is BY WHO DOES THE WORK, not by which paragraph names it:
 *   • Application — the recruiter's act of asking.
 *   • Employment  — the §391.21(b)(10) record and the §391.23 investigation OF that record. One job,
 *                   correctly adjacent, and the only pair that was always meant to be together.
 *   • Screening   — a vendor ledger, which is not employment at all.
 *
 * ⚠ `employment` KEEPS ITS VALUE and keeps meaning the history, so every existing `?section=`
 * deep link still resolves and no redirect is needed. What moved is the INTENT of two links that
 * said "employment" when they meant "where the invitation is minted" — `RecruitmentPage`'s row
 * click and `InviteApplicantDrawer`'s recovery button now say `application`. `InquiryQueuePage`
 * meant the history all along and is untouched.
 */
type Section = DriverSection;
const SECTIONS: TabItem[] = DRIVER_PAGE_SECTIONS.map((s) => ({ value: s.value, label: s.label }));
const section = computed<Section>(() => resolveDriverSection(route.query.section));

/**
 * The three sections whose content left for the recruitment surface at R7 (D-ROS6).
 *
 * They still RESOLVE — `?section=` is a public surface and those values are in bookmarks and binder
 * references — so the page redirects rather than 404s or silently shows something else. `replace`,
 * not `push`: an old link should not leave a dead entry in the reader's history for them to press
 * Back into.
 */
watch(
  [section, id],
  ([s, driverId]: [DriverSection, string]) => {
    const moved = driverId ? relocatedSectionPath(s, driverId) : null;
    if (moved) void router.replace(moved);
  },
  { immediate: true },
);
/**
 * `?section=` is an ANCHOR, not a tab switch (R6b, D-ROS5).
 *
 * ── WHY THE TABS BECAME ONE SCROLL ──────────────────────────────────────────────────────────────
 * Tabs were the right answer while this page carried six sections spanning four regulations and
 * three different readers (U6/D-UI7). R7 moved the recruiting half to its own surface, and what is
 * left — who this person is, whether they may be dispatched, and what they have burned — is one
 * reader's single question about one driver. Three tabs to answer it is three clicks to see a whole
 * that fits on a page.
 *
 * ── AND WHY THE QUERY STRING SURVIVED IT ────────────────────────────────────────────────────────
 * Every existing value still resolves and still lands the reader in the right place; it scrolls
 * instead of switching. `/compliance/:id` redirects into `?section=qualification`, the binder cites
 * it, and it is in bookmarks — so the vocabulary is the one thing this change was not allowed to
 * touch. `driverSections.test.ts` passes unchanged, which is how that is checkable rather than
 * merely asserted.
 */
function scrollToSection(s: Section): void {
  // `getElementById` rather than a template ref: these are plain markup sections, and an id is what
  // the URL is naming.
  const el = typeof document !== "undefined" ? document.getElementById(`section-${s}`) : null;
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
}

watch(
  section,
  (s) => {
    // After render, or the anchor is not in the DOM yet on a cold load from a deep link.
    void nextTick(() => scrollToSection(s));
  },
  { immediate: true },
);

function setSection(s: Section): void {
  void router.replace({ query: { ...route.query, section: s === "profile" ? undefined : s } });
}

// The export action stays on the HOST header (D1's split): it belongs to the page, not the section.
const session = useSessionStore();
// Fuel history belongs to the fuel section, and a recruiter holds roster `view` (so can open a driver's
// file) without it. Until migration 0416 refused that read at the database (audit 2026-10-03 finding 1)
// this page queried the fills for every role that could open it. The queries are switched off rather
// than the cards merely hidden, so no role without the section sends the request, and the cards go with
// them: a summary reading "Fills 0 · Gallons 0" would claim the driver has never fuelled.
const canSeeFuel = computed(() => session.canView("fuel"));
// DE2b: the tablets this driver holds come from the shop's assets route (`maintenance: view`), which a
// recruiter on this page may not hold — so the card is the matrix's answer, not everybody's.
const canSeeEquipment = computed(() => session.canView("maintenance"));
const toast = useToastStore();
const requestBinder = useRequestBinder();
async function exportWholeFile(): Promise<void> {
  await requestBinder.mutateAsync({ driverIds: [id.value], asAt: null });
  toast.success("Building the file", "It appears under Exports on the qualification page shortly.");
}
const PAGE = 500;

async function fetchAllFills(driverId: string): Promise<FuelTransaction[]> {
  const rows: FuelTransaction[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("fuel_transactions")
      // `miles_since_last` is selected because this driver's MPG is now a ratio of sums over those
      // spans (M4, D-MPG3) rather than a gallon-weighted mean of `computed_mpg` — see `driverMpg`.
      .select(
        "id, org_id, vehicle_id, driver_id, fueled_at, odometer, miles_since_last, gallons, price_per_gal, total_cost, location_text, state, source, computed_mpg, has_anomaly, max_severity, ai_risk_level, created_at",
      )
      .eq("driver_id", driverId)
      .eq("is_canonical", true)
      .order("fueled_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as FuelTransaction[];
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
  }
}

/**
 * The full profile, through the roster API rather than a browser `select("*")`.
 *
 * Two reasons, and the second is the one that mattered here. `DriverDetail` is the shape the editable
 * section below needs — a raw select typed as `Driver` carries the columns but not the type, which is
 * how a page ends up casting. And R6a moved the driver WRITES onto this API; leaving the read on a
 * `select("*")` would mean the page asked for every column it does not render, including ones a
 * future migration might add.
 */
const driverQuery = useDriverQuery(id);
const driver = driverQuery.data;
/**
 * No such driver in this company (F21). The page used to read only `data`, so a missing driver was a
 * page of blank sections under "Driver" and a failed read was never said at all.
 */
const missing = computed(() => isNotFound(driverQuery.error.value));
// The dispatch door's own answer (MEDSTOP-PLAN §7A.15), so a Med-Stop hold shows here too — and only a
// testing-record reader is told it is Med-Stop's; everybody else reads "outstanding safety review".
const holdQ = useDispatchHoldQuery(id);
const holdNotice = computed(() => (holdQ.data.value ? dispatchHoldNotice(holdQ.data.value, formatDate) : null));
const binderExportScope = computed(() =>
  driver.value?.full_name
    ? `${driver.value.full_name} · Complete qualification file`
    : "Complete qualification file",
);

// The fuel panels wait for their reads (F9/F10, US6b): a failed read drew "No fills yet" and "No
// anomalies", claims about the driver made by a request that never reached them.
const txnsQuery = useQuery({
  queryKey: ["driver-fills", id],
  enabled: computed(() => Boolean(id.value) && canSeeFuel.value),
  queryFn: () => fetchAllFills(id.value),
});
const txns = txnsQuery.data;

// D-CF9 (0439): cases before the org's detection start date are not listed (useDetectionEpoch.ts).
const { epoch: detectionEpoch, ready: epochReady } = useDetectionEpoch();
const anomaliesQuery = useQuery({
  queryKey: ["driver-anomalies", id, detectionEpoch],
  enabled: computed(
    () => Boolean(id.value) && canSeeFuel.value && txns.value !== undefined && epochReady.value,
  ),
  queryFn: async (): Promise<Anomaly[]> => {
    const transactionIds = (txns.value ?? []).map((t) => t.id);
    if (transactionIds.length === 0) return [];
    const { data, error } = await afterReset(
      supabase
        .from("anomalies")
        .select(
          "id, severity, status, rule_id, message, created_at, transaction_id, org_id, vehicle_id, evidence, source, assigned_to, resolved_by, resolved_at, resolution_note, version, updated_at, fueled_at",
        )
        .in("transaction_id", transactionIds)
        .neq("status", "superseded"),
      detectionEpoch.value,
    ).order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as Anomaly[];
  },
});
const anomalies = anomaliesQuery.data;
/** The anomalies are read for the fills' ids, so a failed fills read is their failure too. */
const anomaliesFailed = computed(() => anomaliesQuery.isError.value || txnsQuery.isError.value);
function retryAnomalies(): void {
  if (txnsQuery.isError.value) void txnsQuery.refetch();
  else void anomaliesQuery.refetch();
}

// The band is `MPG_PLAUSIBLE_MIN/MAX` from `@silvicom/shared`, not the `>= 1 && <= 40` this line used
// to hardcode. One definition of "this odometer reading is corrupt", and it lives beside the
// arithmetic that applies it (M4, D-MPG1).
const mpgPoints = computed(() =>
  (txns.value ?? []).filter(
    (t) => t.computed_mpg != null && plausibleFillMpg(Number(t.computed_mpg)),
  ),
);
const mpgChart = computed<ChartConfiguration>(() => ({
  type: "line",
  data: {
    labels: mpgPoints.value.map((t) => t.fueled_at.slice(0, 10)),
    datasets: [
      {
        label: "MPG",
        data: mpgPoints.value.map((t) => Number(t.computed_mpg)),
        borderColor: viz.brand,
        backgroundColor: areaFill("--viz-brand"),
        fill: true,
        tension: 0.35,
        borderWidth: 2.5,
        pointRadius: 0,
        pointHitRadius: 12,
      },
    ],
  },
  options: { responsive: true, maintainAspectRatio: false },
}));

const recent = computed(() => [...(txns.value ?? [])].reverse().slice(0, 20));
// A dash until the list has answered — a count of an unread list is not zero.
const openAnomalies = computed(() =>
  anomalies.value
    ? anomalies.value.filter((a) => a.status === "open" || a.status === "investigating").length
    : null,
);
const totalGallons = computed(() =>
  (txns.value ?? []).reduce((sum, t) => sum + Number(t.gallons || 0), 0),
);
/**
 * This driver's MPG — a DIFFERENT figure from the fleet's, and labelled as one (M4, D-MPG3).
 *
 * It answers "what did this driver's fills achieve", over odometer spans between their own fills. The
 * fleet number answers "how far did the fleet go on the fuel it bought", from two odometer readings
 * the vendor asserted at the ends of a period. Different miles, different gallons, different edges —
 * so the label says whose figure this is rather than inviting the two to be compared.
 *
 * The arithmetic moved into `computeSubjectMpg`: it sums the spans and recovers each span's real
 * gallons instead of multiplying a stored ratio back out by `gallons` alone, which is the
 * intermediate-gallons bias the plan measured at 1.31–2.41% low.
 */
const driverMpg = computed(() =>
  computeSubjectMpg(
    (txns.value ?? []).map((t) => ({
      miles: t.miles_since_last == null ? null : Number(t.miles_since_last),
      mpg: t.computed_mpg == null ? null : Number(t.computed_mpg),
      gallons: Number(t.gallons || 0),
    })),
  ),
);
const avgMpg = computed(() => driverMpg.value.mpg);
/** The summary card's fuel facts (D-US6). A blank is `null`, so `FactList` draws its em dash. */
const fuelFacts = computed<Fact[]>(() => [
  { label: "Fills", value: txns.value?.length ?? null, numeric: true },
  { label: "Gallons", value: txns.value ? Math.round(totalGallons.value).toLocaleString() : null, numeric: true },
  { key: "mpg", label: "MPG on this driver's fills", value: avgMpg.value != null ? avgMpg.value.toFixed(1) : null, numeric: true },
  { label: "Open anomalies", value: openAnomalies.value, numeric: true },
]);
const fmt = (iso: string, state: string | null) => stationDate(iso, state);
const fillColumns: DataTableColumn[] = [
  { key: "fueled_at", label: "Date", cellClass: "text-ink-muted" },
  { key: "gallons", label: "Gallons", numeric: true },
  { key: "computed_mpg", label: "MPG", numeric: true, cellClass: "text-ink-secondary" },
  { key: "vehicle_id", label: "Vehicle", cellClass: "text-ink-muted" },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      :title="driver?.full_name ?? 'Driver'"
      description="Profile, qualification file and fueling history"
    >
      <template #actions>
        <!-- No longer gated on the qualification TAB being open: there are no tabs, and the button
             exports the §391.51 file whichever part of the page the reader has scrolled to. -->
        <ExportButton
          v-if="session.can('roster') && !missing"
          :run="exportWholeFile"
          :scope="binderExportScope"
          label="Export this file"
          busy-label="Building…"
          error-title="Could not start the export"
          :disabled="requestBinder.isPending.value"
        />
      </template>
    </PageHeader>

    <!-- The driver's own read: its loading line, its failure with a Retry, or the not-found answer
         that replaces the whole page (F21). Every section below has its own read and its own states. -->
    <QueryState
      :loading="driverQuery.isPending.value"
      :error="driverQuery.isError.value ? driverQuery.error.value : null"
      :retrying="driverQuery.isFetching.value"
      loading-text="Loading the driver…"
      error-text="Could not load the driver."
      not-found-text="That driver is not in this company."
      @retry="driverQuery.refetch()"
    />

    <template v-if="!missing">
      <!-- §40.25(j) (0237). Above the tab strip and outside every section, because it is not a fact
           about one part of this driver's file — it is a limit on what the driver may be given to do,
           and somebody arriving on the fuel history has as much reason to see it as somebody on
           qualification. ⚠ The admission reads the same to everybody who can open this page; a Med-Stop
           violation names its result and day only to a testing-record reader (`dispatchHoldNotice`).
           The document that lifts either is a testing record behind Qualification's own access rules. -->
      <AppCallout v-if="holdNotice" tone="warning">
        {{ holdNotice }}
      </AppCallout>

      <!-- U4/D-UI4's strip, now a JUMP NAV rather than a tab strip: every section is on the page and
           this scrolls to one. ⚠ Still no `id-prefix` — `aria-controls` names a panel the strip
           controls, and these sections are named by the URL rather than owned by the strip. -->
      <AppTabs
        :model-value="section"
        :tabs="SECTIONS"
        label="Driver sections"
        @update:model-value="setSection($event as Section)"
      />

      <section id="section-qualification" class="scroll-mt-6">
        <QualificationSection :driver-id="id" />
      </section>

      <!-- §395.8(j)(2) — a record about EMPLOYMENT, not about hiring, so R7 left it behind when the
           recruiting sections went. It sits under Profile until R6b gives it the "Employment & pay"
           section it belongs in; parking it on the recruitment surface would have been filing an
           hours-of-service record with the hiring paperwork because that is where it happened to be. -->
      <SevenDayStatementSection :driver-id="id" />

      <!-- D-ROS1's "the record page writes", scoped by D-ROS2: the fields no sync owns and nothing
           legal turns on, editable in place. Everything dangerous stays in the roster's drawer, which
           warns before it claims and reports what the edit meant (R6a) — no field is editable in two
           places, which is the whole answer to §6 Q8. -->
      <div id="section-profile" class="scroll-mt-6">
        <DriverContactSection :driver="driver ?? null" />
      </div>

      <BaseCard v-if="driver">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-sm font-semibold text-ink">Driver summary</h2>
          </div>
          <StatusBadge :status="driver.status" />
        </div>
        <FactList v-if="canSeeFuel" class="mt-4" :facts="fuelFacts">
          <!-- Why there is no MPG, under the dash: the reason belongs to the figure, not to a tooltip only. -->
          <template #value-mpg="{ fact }">
            <span :title="driverMpg.reason ?? undefined">
              <template v-if="fact.value != null">{{ fact.value }}</template>
              <span v-else class="font-normal text-ink-tertiary">—</span>
            </span>
            <span v-if="driverMpg.reason" class="block text-xs font-normal text-ink-tertiary">{{ driverMpg.reason }}</span>
          </template>
        </FactList>
      </BaseCard>

      <HolderEquipmentCard v-if="canSeeEquipment && driver" :target="{ kind: 'driver', id, label: driver.full_name }" />

      <BaseCard v-if="canSeeFuel" id="section-fuel" class="scroll-mt-6">
        <h3 class="mb-3 text-sm font-semibold text-ink">MPG history</h3>
        <QueryState
          compact
          :loading="txnsQuery.isLoading.value"
          :error="txnsQuery.isError.value"
          :retrying="txnsQuery.isFetching.value"
          loading-text="Loading the fills…"
          error-text="Could not load the fills."
          @retry="txnsQuery.refetch()"
        >
          <BaseChart v-if="mpgPoints.length" :config="mpgChart" :height="260" />
          <p v-else class="text-sm text-ink-muted">Not enough valid data to chart MPG yet.</p>
        </QueryState>
      </BaseCard>

      <div v-if="canSeeFuel" class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div class="space-y-3">
          <h3 class="text-sm font-semibold text-ink">Recent fills</h3>
          <DataTable
            :columns="fillColumns"
            :rows="recent"
            row-key="id"
            :loading="txnsQuery.isLoading.value"
            :error="txnsQuery.isError.value ? 'Could not load the fills.' : null"
            :retrying="txnsQuery.isFetching.value"
            empty-text="No fills yet."
            @retry="txnsQuery.refetch()"
          >
            <template #cell-fueled_at="{ row }">{{ fmt(row.fueled_at, row.state ?? null) }}</template>
            <template #cell-gallons="{ value }">{{ value != null ? `${value} gal` : "—" }}</template>
            <template #cell-computed_mpg="{ value }">{{ value != null ? `${value} mpg` : "—" }}</template>
          </DataTable>
        </div>
        <BaseCard padding="none">
          <h3 class="border-b border-edge-subtle px-5 py-3 text-sm font-semibold text-ink">
            Anomalies
          </h3>
          <!-- `isPending`: the read waits on the fills and the detection epoch, and while it is
               disabled `isLoading` is false — which drew "No anomalies" before anything was asked. -->
          <div v-if="anomaliesQuery.isPending.value || anomaliesFailed" class="px-5 py-3">
            <QueryState
              compact
              :loading="!anomaliesFailed"
              :error="anomaliesFailed"
              :retrying="anomaliesQuery.isFetching.value || txnsQuery.isFetching.value"
              loading-text="Loading the anomalies…"
              error-text="Could not load the anomalies."
              @retry="retryAnomalies"
            />
          </div>
          <ul v-else class="divide-y divide-edge-subtle text-sm">
            <li
              v-for="a in anomalies ?? []"
              :key="a.id"
              class="flex items-center justify-between px-5 py-2"
            >
              <span class="text-ink-secondary" :title="a.rule_id">{{ a.rule_id }}</span>
              <StatusBadge :status="a.status" />
            </li>
            <li v-if="(anomalies ?? []).length === 0" class="px-5 py-3 text-ink-muted">
              No anomalies.
            </li>
          </ul>
        </BaseCard>
      </div>
    </template>
  </div>
</template>
