<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import type { ChartConfiguration } from "chart.js";
import type { Anomaly, Driver, FuelTransaction } from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";
import { stationDate } from "@/lib/stationTime";
import BaseChart from "@/components/BaseChart.vue";
import StatusBadge from "@/components/StatusBadge.vue";
import { AppButton as BaseButton, AppCard as BaseCard, AppTabs, type TabItem } from "@fuelguard/ui";
import { DRIVER_SECTIONS, resolveDriverSection, type DriverSection } from "./driverSections";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import { viz, areaFill } from "@/features/dashboard/chartTheme";
import PageHeader from "@/components/ui/PageHeader.vue";
import QualificationSection from "@/features/compliance/QualificationSection.vue";
import EmploymentHistorySection from "@/features/recruitment/EmploymentHistorySection.vue";
import PspRecordsSection from "@/features/recruitment/PspRecordsSection.vue";
import EmployerInquirySection from "@/features/recruitment/EmployerInquirySection.vue";
import ApplicationInviteCard from "@/features/recruitment/ApplicationInviteCard.vue";
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
const SECTIONS: TabItem[] = DRIVER_SECTIONS.map((s) => ({ value: s.value, label: s.label }));
const section = computed<Section>(() => resolveDriverSection(route.query.section));
function setSection(s: Section): void {
  void router.replace({ query: { ...route.query, section: s === "profile" ? undefined : s } });
}

// The export action stays on the HOST header (D1's split): it belongs to the page, not the section.
const session = useSessionStore();
const toast = useToastStore();
const requestBinder = useRequestBinder();
async function exportWholeFile(): Promise<void> {
  try {
    await requestBinder.mutateAsync({ driverIds: [id.value], asAt: null });
    toast.success("Building the file", "It appears under Exports on the qualification page shortly.");
  } catch (e) {
    toast.error("Could not start the export", e instanceof Error ? e.message : undefined);
  }
}
const PAGE = 500;

async function fetchAllFills(driverId: string): Promise<FuelTransaction[]> {
  const rows: FuelTransaction[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("fuel_transactions")
      .select("id, org_id, vehicle_id, driver_id, fueled_at, odometer, gallons, price_per_gal, total_cost, location_text, state, source, computed_mpg, has_anomaly, max_severity, ai_risk_level, created_at")
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

const { data: driver } = useQuery({
  queryKey: ["driver-detail", id],
  enabled: computed(() => Boolean(id.value)),
  queryFn: async (): Promise<Driver | null> => {
    const { data, error } = await supabase.from("drivers").select("*").eq("id", id.value).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as Driver | null) ?? null;
  },
});

const { data: txns } = useQuery({
  queryKey: ["driver-fills", id],
  enabled: computed(() => Boolean(id.value)),
  queryFn: () => fetchAllFills(id.value),
});

const { data: anomalies } = useQuery({
  queryKey: ["driver-anomalies", id],
  enabled: computed(() => Boolean(id.value) && txns.value !== undefined),
  queryFn: async (): Promise<Anomaly[]> => {
    const transactionIds = (txns.value ?? []).map((t) => t.id);
    if (transactionIds.length === 0) return [];
    const { data, error } = await supabase
      .from("anomalies")
      .select("id, severity, status, rule_id, message, created_at, transaction_id, org_id, vehicle_id, evidence, source, assigned_to, resolved_by, resolved_at, resolution_note, version, updated_at")
      .in("transaction_id", transactionIds)
      .neq("status", "superseded")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as Anomaly[];
  },
});

const mpgPoints = computed(() => (txns.value ?? []).filter((t) => t.computed_mpg != null && Number(t.computed_mpg) >= 1 && Number(t.computed_mpg) <= 40));
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
const openAnomalies = computed(() => (anomalies.value ?? []).filter((a) => a.status === "open" || a.status === "investigating").length);
const totalGallons = computed(() => (txns.value ?? []).reduce((sum, t) => sum + Number(t.gallons || 0), 0));
const avgMpg = computed(() => {
  const valid = mpgPoints.value;
  const gallons = valid.reduce((sum, t) => sum + Number(t.gallons || 0), 0);
  return gallons > 0 ? valid.reduce((sum, t) => sum + Number(t.computed_mpg) * Number(t.gallons || 0), 0) / gallons : null;
});
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
    <PageHeader :title="driver?.full_name ?? 'Driver'" description="Profile, qualification file, hiring paperwork and fueling history">
      <template #actions>
        <BaseButton
          v-if="section === 'qualification' && session.canManage"
          variant="ghost"
          :disabled="requestBinder.isPending.value"
          @click="exportWholeFile"
        >
          {{ requestBinder.isPending.value ? "Building…" : "Export this file" }}
        </BaseButton>
      </template>
    </PageHeader>

    <!-- U4/D-UI4: the shared strip. ⚠ No `id-prefix` here: these panels are plain `v-if` blocks with
         no id to point `aria-controls` at, and a dangling reference is worse than none. -->
    <AppTabs
      :model-value="section"
      :tabs="SECTIONS"
      label="Driver sections"
      @update:model-value="setSection($event as Section)"
    />

    <QualificationSection v-if="section === 'qualification'" :driver-id="id" />

    <!-- The recruiter's act of asking. It PRODUCES the history in the next tab (H5, D-HIRE2), which
         is why it reads first left-to-right rather than being filed under it. -->
    <ApplicationInviteCard
      v-if="section === 'application'"
      :driver-id="id"
      :driver-status="driver?.status ?? ''"
    />

    <template v-if="section === 'employment'">
      <EmploymentHistorySection :driver-id="id" />
      <!-- The §391.23 investigation of the history above it (EMPLOYER-INQUIRY-PLAN E3). These two
           stay together: they are one job, and separating a record from the investigation of that
           record is what would actually cost a recruiter a click. -->
      <EmployerInquirySection :driver-id="id" />
    </template>

    <!-- A vendor ledger, which is not employment. It stays on the driver page rather than moving to
         Qualification because that section's write affordances gate on canManageFleet, which a
         recruiter is not (PSP-PLAN P14). -->
    <PspRecordsSection v-if="section === 'screening'" :driver-id="id" />

    <BaseCard v-if="section === 'profile' && driver">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-sm font-semibold text-ink">Driver summary</h2>
        </div>
        <StatusBadge :status="driver.status" />
      </div>
      <dl class="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><dt class="text-ink-muted">Fills</dt><dd class="font-medium text-ink">{{ txns?.length ?? "—" }}</dd></div>
        <div><dt class="text-ink-muted">Gallons</dt><dd class="font-medium text-ink">{{ Math.round(totalGallons).toLocaleString() }}</dd></div>
        <div><dt class="text-ink-muted">Average MPG</dt><dd class="font-medium text-ink">{{ avgMpg != null ? avgMpg.toFixed(1) : "—" }}</dd></div>
        <div><dt class="text-ink-muted">Open anomalies</dt><dd class="font-medium text-ink">{{ openAnomalies }}</dd></div>
      </dl>
    </BaseCard>

    <BaseCard v-if="section === 'fuel'">
      <h3 class="mb-3 text-sm font-semibold text-ink">MPG history</h3>
      <BaseChart v-if="mpgPoints.length" :config="mpgChart" :height="260" />
      <p v-else class="text-sm text-ink-muted">Not enough valid data to chart MPG yet.</p>
    </BaseCard>

    <div v-if="section === 'fuel'" class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div class="space-y-3">
        <h3 class="text-sm font-semibold text-ink">Recent fills</h3>
        <DataTable :columns="fillColumns" :rows="recent" row-key="id" empty-text="No fills yet.">
          <template #cell-fueled_at="{ row }">{{ fmt(row.fueled_at, row.state ?? null) }}</template>
          <template #cell-gallons="{ value }">{{ value }} gal</template>
          <template #cell-computed_mpg="{ value }">{{ value ?? "—" }} mpg</template>
        </DataTable>
      </div>
      <BaseCard padding="none">
        <h3 class="border-b border-edge-subtle px-5 py-3 text-sm font-semibold text-ink">Anomalies</h3>
        <ul class="divide-y divide-edge-subtle text-sm">
          <li v-for="a in anomalies ?? []" :key="a.id" class="flex items-center justify-between px-5 py-2">
            <span class="text-ink-secondary" :title="a.rule_id">{{ a.rule_id }}</span>
            <StatusBadge :status="a.status" />
          </li>
          <li v-if="(anomalies ?? []).length === 0" class="px-5 py-3 text-ink-muted">No anomalies.</li>
        </ul>
      </BaseCard>
    </div>
  </div>
</template>
