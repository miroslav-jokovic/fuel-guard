<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { AppCard as BaseCard, AppButton as BaseButton } from "@silvicom/ui";
import { inspectionLevelLabel, type RoadsideMatchMethod, type RoadsideUnitDetailDto, type RoadsideViolationDto } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import QueryState from "@/components/ui/QueryState.vue";
import FactList, { type Fact } from "@/components/ui/FactList.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import { useRoadsideInspectionQuery } from "@/features/roadside/useRoadsideInspections";
import { useOpens } from "@/composables/useOpens";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDate } from "@/lib/format";

/**
 * One roadside inspection as FMCSA records it — the row `RoadsideInspectionsPage` opens
 * (INSPECTION-CHALLENGE-PLAN §6, the Inspection page's header, units and violations).
 *
 * ── WHAT IT SHOWS IS THE REPORT, NOT A READING OF IT ───────────────────────────────────────────
 * Times are the report's local clock, as written: resolving them to an instant needs the truck's GPS
 * and is IC5's (D-IC8). The level, the violation category and the defect's outcome are named from
 * FMCSA's own data dictionary (plan Q-IC5), never paraphrased. A violation's code and
 * description are FMCSA's words; its SMS weight and BASIC are IC3's. A unit says how it matched one
 * of ours, because a unit-number match is the weakest of the three (0458), and an unmatched one says
 * so rather than borrowing a near match (D-IC7).
 *
 * ── NO DRIVER ──────────────────────────────────────────────────────────────────────────────────
 * FMCSA's public record does not name the driver. Attribution is IC5's, and a guessed driver is the
 * thing D-IC7 forbids — so the page says the driver is not on the record rather than leaving a gap.
 */

const route = useRoute();
const id = computed(() => String(route.params.id));
const { data: inspection, isLoading, isError, error, isFetching, refetch } = useRoadsideInspectionQuery(id);

const yesNo = (b: boolean | null) => (b == null ? null : b ? "Yes" : "No");
const clock = (hhmm: string | null) => (hhmm && /^\d{4}$/.test(hhmm) ? `${hhmm.slice(0, 2)}:${hhmm.slice(2)}` : null);
const KIND: Record<RoadsideUnitDetailDto["kind"], string> = { tractor: "Tractor", trailer: "Trailer", other: "Other unit" };
const MATCHED_BY: Record<RoadsideMatchMethod, string> = { vin: "VIN", plate: "plate", unit_number: "unit number" };

const facts = computed<Fact[]>(() => {
  const i = inspection.value;
  if (!i) return [];
  const start = clock(i.startTime);
  const end = clock(i.endTime);
  return [
    { label: "Date", value: i.inspectionDate ? formatDate(i.inspectionDate) : null },
    { label: "Time (local)", value: start && end ? `${start}–${end}` : (start ?? end) },
    { label: "Level", value: inspectionLevelLabel(i.level) },
    { label: "Site", value: i.facility === "fixed" ? "Fixed site" : i.facility === "roadside" ? "Roadside" : null },
    { label: "Location", value: [i.locationDesc, i.reportState].filter(Boolean).join(", ") || null },
    { label: "Post-accident", value: yesNo(i.postAccident) },
    { label: "Hazmat placard required", value: yesNo(i.hazmatPlacardRequired) },
    { label: "Gross weight", value: i.grossWeightLb != null ? `${i.grossWeightLb.toLocaleString("en-US")} lb` : null },
    { label: "Shipper", value: i.shipperName },
  ];
});

const counts = computed<Fact[]>(() => {
  const i = inspection.value;
  if (!i) return [];
  const alarm = (n: number | null) => ((n ?? 0) > 0 ? "text-danger-700" : undefined);
  return [
    { label: "Violations", value: i.violations, numeric: true },
    { label: "Driver OOS", value: i.driverOos, numeric: true, tone: alarm(i.driverOos) },
    { label: "Vehicle OOS", value: i.vehicleOos, numeric: true, tone: alarm(i.vehicleOos) },
    { label: "Hazmat OOS", value: i.hazmatOos, numeric: true, tone: alarm(i.hazmatOos) },
  ];
});

const unitName = (u: RoadsideUnitDetailDto) => [KIND[u.kind], u.companyNumber].filter(Boolean).join(" ");
const againstLabel = (v: RoadsideViolationDto) => {
  if (!v.against) return null;
  if ("driver" in v.against) return "Driver";
  const seq = v.against.unitSeq;
  const unit = inspection.value?.units.find((u) => u.seq === seq);
  return unit ? `Unit ${seq} · ${unitName(unit)}` : `Unit ${seq}`;
};
// The truck's page is the equipment section's; the link shows only to a reader the router would let in
// (SP5's `useOpens`, the guard's own answer), so nobody follows it to a bounce.
const opens = useOpens();
const truckLink = (u: RoadsideUnitDetailDto) => {
  if (!u.vehicleId) return null;
  const to = { name: "vehicle-detail", params: { id: u.vehicleId } };
  return opens(to) ? to : null;
};

const UNIT_COLUMNS: DataTableColumn[] = [
  { key: "seq", label: "#", numeric: true, width: "xs" },
  { key: "kind", label: "Unit", width: "md" },
  { key: "make", label: "Make", width: "sm" },
  { key: "plate", label: "Plate", width: "md" },
  { key: "vin", label: "VIN", width: "lg" },
  { key: "decal", label: "CVSA decal", width: "sm" },
  { key: "matchedBy", label: "Ours", width: "lg" },
];
const VIOLATION_COLUMNS: DataTableColumn[] = [
  { key: "against", label: "Against", width: "lg" },
  { key: "code", label: "Code", width: "md" },
  { key: "description", label: "Violation", width: "3xl" },
  { key: "outOfService", label: "Out of service", width: "sm" },
  { key: "citationNumber", label: "Citation", width: "md" },
  { key: "courtResults", label: "Court result", width: "lg" },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      :title="inspection?.reportNumber ? `Report ${inspection.reportNumber}` : 'Roadside inspection'"
      description="As recorded on our FMCSA record, refreshed daily."
    />

    <QueryState
      :loading="isLoading && !inspection"
      :error="isError ? error : null"
      :retrying="isFetching"
      loading-text="Loading the inspection…"
      error-text="Could not load the roadside inspection."
      @retry="refetch()"
    >
      <template v-if="inspection">
        <BaseCard>
          <h2 class="text-sm font-semibold text-ink">Inspection</h2>
          <FactList class="mt-4" :facts="facts" data-test="facts" />
          <div class="mt-5 border-t border-edge pt-5">
            <FactList :facts="counts" data-test="counts" />
          </div>
          <p class="mt-4 text-xs text-ink-tertiary">The driver is not on FMCSA's public record, so it is not shown here.</p>
        </BaseCard>

        <section class="space-y-3" aria-labelledby="violations-heading">
          <h2 id="violations-heading" class="text-sm font-semibold text-ink">Violations</h2>
          <DataTable :columns="VIOLATION_COLUMNS" :rows="inspection.violationList" row-key="id" :nowrap="false" empty-text="No violations recorded on this inspection.">
            <template #cell-against="{ row }">{{ againstLabel(row as RoadsideViolationDto) ?? "—" }}</template>
            <template #cell-code="{ value }"><span class="font-mono text-xs">{{ value ?? "—" }}</span></template>
            <template #cell-description="{ row }">
              {{ (row as RoadsideViolationDto).description ?? "—" }}
              <p v-if="(row as RoadsideViolationDto).category" class="mt-0.5 text-xs text-ink-muted" data-test="category">{{ (row as RoadsideViolationDto).category }}</p>
            </template>
            <template #cell-outOfService="{ row }">
              <template v-if="(row as RoadsideViolationDto).outOfService">
                <span :class="[BADGE_BASE, toneClass('danger'), 'whitespace-nowrap']" data-test="oos">Out of service</span>
                <!-- What became of the defect — only beside an order, where it says something ("not out of
                     service" is on every other line). -->
                <p v-if="(row as RoadsideViolationDto).defectVerification" class="mt-1 text-xs text-ink-muted" data-test="defect">{{ (row as RoadsideViolationDto).defectVerification }}</p>
              </template>
              <span v-else class="text-ink-tertiary">No</span>
            </template>
            <template #cell-citationNumber="{ value }">{{ value ?? "—" }}</template>
            <template #cell-courtResults="{ value }">
              <span v-if="(value as string[]).length">{{ (value as string[]).join("; ") }}</span>
              <span v-else class="text-ink-tertiary">—</span>
            </template>
          </DataTable>
        </section>

        <section class="space-y-3" aria-labelledby="units-heading">
          <h2 id="units-heading" class="text-sm font-semibold text-ink">Units</h2>
          <DataTable :columns="UNIT_COLUMNS" :rows="inspection.units" :row-key="(u: RoadsideUnitDetailDto) => String(u.seq)" empty-text="No units on this report.">
            <template #cell-seq="{ value }">{{ value ?? "—" }}</template>
            <template #cell-kind="{ row }">{{ unitName(row as RoadsideUnitDetailDto) }}</template>
            <template #cell-make="{ value }">{{ value ?? "—" }}</template>
            <template #cell-plate="{ row }">
              {{ (row as RoadsideUnitDetailDto).plate ? [(row as RoadsideUnitDetailDto).plate, (row as RoadsideUnitDetailDto).plateState].filter(Boolean).join(" · ") : "—" }}
            </template>
            <template #cell-vin="{ value }"><span class="font-mono text-xs">{{ value ?? "—" }}</span></template>
            <template #cell-decal="{ value }">{{ yesNo(value as boolean | null) ?? "—" }}</template>
            <template #cell-matchedBy="{ row }">
              <span v-if="(row as RoadsideUnitDetailDto).matchedBy" data-test="match">
                <BaseButton
                  v-if="truckLink(row as RoadsideUnitDetailDto)"
                  variant="link"
                  :to="truckLink(row as RoadsideUnitDetailDto)!"
                >Ours</BaseButton><template v-else>Ours</template>, by {{ MATCHED_BY[(row as RoadsideUnitDetailDto).matchedBy!] }}
              </span>
              <span v-else class="text-ink-tertiary" data-test="match">Not matched to ours</span>
            </template>
          </DataTable>
        </section>
      </template>
    </QueryState>
  </div>
</template>
