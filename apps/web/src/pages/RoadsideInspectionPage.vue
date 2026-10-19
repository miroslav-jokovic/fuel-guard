<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import {
  AppCard as BaseCard,
  AppButton as BaseButton,
  QueryState,
  FactList,
  type Fact,
  DataTable,
  type DataTableColumn,
} from "@silvicom/ui";
import {
  SMS_BASIC_NAMES,
  SMS_EXCLUSION_TEXT,
  SMS_TIME_WEIGHT_TEXT,
  inspectionLevelLabel,
  smsPointsWithheldReason,
  type RoadsideMatchMethod,
  type RoadsideSmsBasicDto,
  type RoadsideStepSection,
  type RoadsideUnitDetailDto,
  type RoadsideViolationDto,
  type RoadsideViolationSmsDto,
} from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import { useRoadsideInspectionQuery } from "@/features/roadside/useRoadsideInspections";
import InspectionDriverCard from "@/features/roadside/InspectionDriverCard.vue";
import InspectionDocumentsCard from "@/features/roadside/InspectionDocumentsCard.vue";
import InspectionRepairCard from "@/features/roadside/InspectionRepairCard.vue";
import InspectionNextSteps from "@/features/roadside/InspectionNextSteps.vue";
import InspectionTicketsCard from "@/features/roadside/InspectionTicketsCard.vue";
import { useOpens } from "@/composables/useOpens";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDate } from "@/lib/format";

/**
 * One roadside inspection as FMCSA records it — the row `RoadsideInspectionsPage` opens
 * (INSPECTION-CHALLENGE-PLAN §6, the Inspection page's header, units and violations).
 *
 * ── WHAT IT SHOWS IS THE REPORT, NOT A READING OF IT ───────────────────────────────────────────
 * Times are the report's local clock, as written; the instant the truck's GPS resolves them to is the
 * driver card's (IC5, D-IC8). The level, the violation category and the defect's outcome are named from
 * FMCSA's own data dictionary (plan Q-IC5), never paraphrased. A violation's code and
 * description are FMCSA's words. A unit says how it matched one
 * of ours, because a unit-number match is the weakest of the three (0458), and an unmatched one says
 * so rather than borrowing a near match (D-IC7).
 *
 * ── CSA POINTS ARE THE API'S, THE PAGE ONLY SAYS THEM ─────────────────────────────────────────
 * Every figure and every "why not" comes from `@silvicom/sms-engine`, run by the API on today's date
 * (`inspectionSms.ts`); nothing here weighs a violation. A violation's points are before the
 * inspection's 30-point cap, which the per-category total applies, so the card says which is which. A
 * category the calculator does not reproduce FMCSA in (Hazardous Materials, plan Q-IC9) shows why its
 * points are withheld, on the row, rather than a number or a blank (D-IC6).
 *
 * ── THE DRIVER IS A READING, NOT THE REPORT'S ──────────────────────────────────────────────────
 * FMCSA's public record does not name the driver. The driver card (`InspectionDriverCard`) shows IC5's
 * reading of Samsara with its confidence and a person's decision over it — never a guessed driver
 * (D-IC7) — so it sits in its own card, apart from what the report says.
 *
 * ── WHAT IS LEFT COMES FIRST (Q-IC17, owner 2026-10-19) ────────────────────────────────────────
 * The page stacked seven equal sections and said nowhere what was open. Now: what happened (the
 * inspection, then its violations with the CSA points as their header line), what is left (the "Next
 * steps" strip, `roadsideNextSteps`), and the cards where each step is done, which the strip scrolls to.
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

const sms = computed(() => inspection.value?.sms ?? null);
/** A violation's points cell: the figure, or why there is none, with how it was reached beneath. */
const pointsCell = (v: RoadsideViolationDto): { value: string; why: string | null; tone: string } => {
  const s: RoadsideViolationSmsDto | undefined = sms.value?.violations[v.id];
  if (!s) return { value: "—", why: null, tone: "text-ink-tertiary" };
  if (s.status === "scored") {
    const oos = s.oosWeight ? ` + ${s.oosWeight} out of service` : "";
    return { value: String(s.points), why: `${SMS_BASIC_NAMES[s.basic]}: severity ${s.severityWeight}${oos}, × ${s.timeWeight}`, tone: "font-medium tabular-nums" };
  }
  if (s.status === "withheld") return { value: "Not shown", why: smsPointsWithheldReason(s.basic), tone: "text-ink-muted" };
  return { value: "None", why: SMS_EXCLUSION_TEXT[s.reason], tone: "text-ink-tertiary" };
};
/** "Adds 95 CSA points today: Vehicle Maintenance 90 · Hours-of-Service Compliance 5" — the verified categories only (D-IC6). */
const smsHeadline = computed(() => {
  const basics = sms.value?.basics ?? [];
  const verified = basics.filter((b) => b.verified);
  const total = verified.reduce((n, b) => n + b.points, 0);
  const shown = verified.length
    ? `Adds ${total} CSA ${total === 1 ? "point" : "points"} today: ${verified.map((b) => `${SMS_BASIC_NAMES[b.basic]} ${b.points}`).join(" · ")}.`
    : "";
  const withheld = basics.filter((b) => !b.verified).map((b) => SMS_BASIC_NAMES[b.basic]);
  return [shown, withheld.length ? `${withheld.join(", ")} points are not shown; the details say why.` : ""].filter(Boolean).join(" ");
});

/**
 * A next step's button brings its card into view and focus (each card carries `tabindex="-1"` for it), so a
 * keyboard or screen-reader user lands where the action is, not only a sighted one.
 */
function go(section: RoadsideStepSection) {
  const el = document.getElementById(`inspection-${section}`);
  if (!el) return;
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  el.focus({ preventScroll: true });
}

const basicTotal = (b: RoadsideSmsBasicDto) => {
  if (!b.verified) return smsPointsWithheldReason(b.basic);
  const sum = b.capped < b.severitySum ? `${b.severitySum}, capped at ${b.capped}` : String(b.capped);
  return `${sum} × ${sms.value!.timeWeight} = ${b.points} points`;
};

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
  { key: "points", label: "CSA points", width: "lg" },
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
      not-found-text="That roadside inspection is not on file for this carrier. The link may be incomplete."
      @retry="refetch()"
    >
      <template v-if="inspection">
        <BaseCard>
          <h2 class="text-sm font-semibold text-ink">Inspection</h2>
          <FactList class="mt-4" :facts="facts" data-test="facts" />
          <div class="mt-5 border-t border-edge pt-5">
            <FactList :facts="counts" data-test="counts" />
          </div>
        </BaseCard>

        <InspectionNextSteps :inspection-id="inspection.id" :inspection-date="inspection.inspectionDate" :attribution="inspection.attribution" @go="go" />

        <section class="space-y-3" aria-labelledby="violations-heading">
          <div>
            <h2 id="violations-heading" class="text-sm font-semibold text-ink">Violations</h2>
            <!-- The CSA points are the violations' header line, not a card of their own (Q-IC17): the total
                 first, how it was reached one click away. -->
            <div v-if="sms" class="mt-1 text-sm" data-test="sms">
              <p v-if="sms.basics.length" class="text-ink" data-test="sms-total">{{ smsHeadline }}</p>
              <p v-else class="text-ink-muted" data-test="sms-none">
                {{ inspection.violationList.length ? "No violation on this inspection adds CSA points; each row says why." : "No violations, so no CSA points." }}
              </p>
              <details v-if="sms.basics.length" class="mt-1">
                <summary class="cursor-pointer text-xs font-medium text-ink-muted">How the CSA points are reached</summary>
                <ul class="mt-2 space-y-1">
                  <li v-for="b in sms.basics" :key="b.basic" data-test="sms-basic">
                    <span class="font-medium text-ink">{{ SMS_BASIC_NAMES[b.basic] }}</span>
                    <span :class="b.verified ? 'text-ink tabular-nums' : 'text-ink-muted'"> — {{ basicTotal(b) }}</span>
                  </li>
                </ul>
                <p class="mt-2 text-xs text-ink-tertiary">
                  Measured today, {{ formatDate(sms.measuredOn) }}, by FMCSA's SMS rules (Appendix A v{{ sms.appendixVersion }}).
                  <template v-if="sms.timeWeight">This inspection is {{ SMS_TIME_WEIGHT_TEXT[sms.timeWeight] }}.</template>
                  Each category's severity on one inspection is capped at {{ sms.cap }} before the time weight. The points beside each violation are before that cap.
                </p>
              </details>
            </div>
          </div>
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
            <template #cell-points="{ row }">
              <span :class="pointsCell(row as RoadsideViolationDto).tone" data-test="points">{{ pointsCell(row as RoadsideViolationDto).value }}</span>
              <p v-if="pointsCell(row as RoadsideViolationDto).why" class="mt-0.5 text-xs text-ink-muted" data-test="points-why">{{ pointsCell(row as RoadsideViolationDto).why }}</p>
            </template>
          </DataTable>
        </section>

        <InspectionDriverCard id="inspection-driver" tabindex="-1" :inspection-id="inspection.id" :attribution="inspection.attribution" />

        <InspectionRepairCard id="inspection-repair" tabindex="-1" :inspection-id="inspection.id" />

        <InspectionTicketsCard
          id="inspection-citations"
          tabindex="-1"
          :inspection-id="inspection.id"
          :inspection-date="inspection.inspectionDate"
          @file-result="go('documents')"
        />

        <InspectionDocumentsCard id="inspection-documents" tabindex="-1" :inspection-id="inspection.id" />

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
              <!-- True of a sold truck and of another carrier's trailer alike; the former-equipment register
                   (Q-IC10 (b)) will name the first kind as ours, retired. -->
              <span v-else class="text-ink-tertiary" data-test="match">Not on our current roster</span>
            </template>
          </DataTable>
        </section>
      </template>
    </QueryState>
  </div>
</template>
