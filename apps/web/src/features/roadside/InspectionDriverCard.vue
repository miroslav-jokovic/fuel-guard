<script setup lang="ts">
import { computed, ref, toRef } from "vue";
import {
  AppButton as BaseButton,
  AppCard as BaseCard,
  AppCombobox as ComboSelect,
  AppFormField as FormField,
  AppTextarea as BaseTextarea,
} from "@silvicom/ui";
import {
  ATTRIBUTION_BASIS_TEXT,
  ATTRIBUTION_LOCATION_TEXT,
  ATTRIBUTION_OUTCOME_TEXT,
  ATTRIBUTION_ZONE_TEXT,
  attributionQuestion,
  type AttributionDriverRefDto,
  type ReportCheckOutcome,
  type ReportCheckState,
  type RoadsideAttributionDto,
  type RoadsideReportCheckDto,
} from "@silvicom/shared";
import { useDriversQuery } from "@/composables/useDrivers";
import { useOpens } from "@/composables/useOpens";
import { useSessionStore } from "@/stores/session";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDateTime } from "@/lib/format";
import { AttributionDecisionError, useDecideAttribution } from "./useRoadsideInspections";

/**
 * Who was driving at the inspection (INSPECTION-CHALLENGE-PLAN §6: "driver with confidence and a
 * 'confirm' action"; D-IC7, D-IC8). Everything it says is the API's: the engine's reading of Samsara,
 * our roster's row for Samsara's driver, and a person's latest decision over it.
 *
 * ── SAMSARA'S DRIVER IS SHOWN AS SAMSARA NAMES THEM WHEN THE ROSTER HAS NO ROW ─────────────────
 * Most drivers in an older inspection are not on our roster (measured 2026-10-14: 916 of 1,117), so
 * "not on our roster" is said, and no roster row with a similar name is offered in its place.
 *
 * ── CONFIRM OR CHOOSE ──────────────────────────────────────────────────────────────────────────
 * A reading of one driver can be confirmed as it is. Any reading can be corrected by choosing one of
 * our drivers, former ones included, with a note saying what shows it was them. Both need the safety
 * section's manage level, which the API checks; the buttons only follow it.
 *
 * ── ASK ONLY WHEN IT MATTERS (IC13, Q-IC15 (b), owner 2026-10-16) ──────────────────────────────
 * A strong reading of a roster driver with nothing against it is the answer, labelled "From Samsara",
 * and the card asks nothing: measured over the last 90 days, that is 76 of 109 inspections that each
 * waited on a person for no reason. The card asks — the reason in words, the buttons primary — only
 * when `attributionQuestion` says so (weak, several, nobody, not on our roster, another state, or an
 * officer's report that disagrees). Changing an answer stays one quiet link away. A person still
 * confirms the driver before any DataQs filing (18 USC 1001, D-IC7); that is the filing's step.
 */

const props = defineProps<{ inspectionId: string; attribution: RoadsideAttributionDto }>();

const session = useSessionStore();
const canDecide = computed(() => session.can("safety"));
const opens = useOpens();
const driverLink = (d: AttributionDriverRefDto | null) => {
  if (!d) return null;
  const to = { name: "driver-detail", params: { id: d.id } };
  return opens(to) ? to : null;
};

const reading = computed(() => props.attribution.reading);
const decision = computed(() => props.attribution.decision);

/** The resolved instant on the inspection's own clock, with the zone's short name (CDT, EST…). */
const when = computed(() => {
  const r = reading.value;
  if (!r?.startedAt || !r.endedAt || !r.zone) return null;
  const end = formatDateTime(r.endedAt, "", r.zone).split(" ").slice(1).join(" ");
  const zone = new Intl.DateTimeFormat("en-US", { timeZone: r.zone, timeZoneName: "short" })
    .formatToParts(new Date(r.startedAt))
    .find((p) => p.type === "timeZoneName")?.value;
  return `${formatDateTime(r.startedAt, "", r.zone)} – ${end}${zone ? ` ${zone}` : ""}`;
});

const badge = computed((): { text: string; tone: "success" | "warning" | "brand" } | null => {
  if (decision.value) {
    const text = { confirmed: "Confirmed by a person", corrected: "Corrected by a person", confirmed_by_report: "Confirmed by the report" }[decision.value.kind];
    return { text, tone: decision.value.kind === "confirmed_by_report" ? "success" : "brand" };
  }
  if (!reading.value) return null;
  return question.value ? { text: "Needs a person", tone: "warning" } : { text: "From Samsara", tone: "brand" };
});

/** Why the card asks, or null when it shows the answer (`attributionQuestion`, shared with the Next steps strip). */
const question = computed(() => {
  const q = attributionQuestion(props.attribution);
  return q && q.reason !== "not_read" ? q : null;
});

/**
 * Each officer's report filed on the inspection and what its check found (IC10). The words are the API's
 * reasons; only the label is said here, keyed so a new state or outcome without one fails the typecheck.
 */
const reports = computed(() => props.attribution.reports);
const REPORT_LABEL: Record<ReportCheckState | ReportCheckOutcome, string> = {
  waiting_for_file: "Waiting to be read",
  reading: "Being read",
  read_failed: "Could not be read",
  checked: "Checked",
  confirmed: "Confirms the driver",
  agrees: "Agrees with the decision",
  needs_review: "Needs a person",
  unreadable: "Could not be read",
};
const REPORT_TONE: Record<ReportCheckState | ReportCheckOutcome, "success" | "warning" | "neutral" | "danger"> = {
  waiting_for_file: "neutral",
  reading: "neutral",
  read_failed: "danger",
  checked: "neutral",
  confirmed: "success",
  agrees: "success",
  needs_review: "warning",
  unreadable: "danger",
};
const reportLabel = (r: RoadsideReportCheckDto) => REPORT_LABEL[r.state === "checked" ? r.outcome! : r.state];

const canConfirm = computed(
  () =>
    canDecide.value &&
    reading.value?.outcome === "one_driver" &&
    !(decision.value?.kind === "confirmed" && decision.value.engineVersion === reading.value.engineVersion),
);

const { data: drivers } = useDriversQuery();
// Former drivers stay choosable: an inspection may be years old. The driver the reading already
// names is left out — choosing them is a confirmation, which the API refuses as a correction.
const driverOptions = computed(() =>
  (drivers.value ?? [])
    .filter((d) => d.id !== reading.value?.driver?.id)
    .map((d) => ({ value: d.id, label: d.status === "active" ? d.full_name : `${d.full_name} (${d.status})` })),
);

const choosing = ref(false);
const driverId = ref("");
const note = ref("");
const decide = useDecideAttribution(toRef(props, "inspectionId"));
const failure = computed(() => {
  const e = decide.error.value;
  if (!e) return null;
  return e instanceof AttributionDecisionError && e.code === "changed"
    ? "Someone else decided while this page was open. Their decision is shown above; look at it before deciding again."
    : e.message;
});

function confirm() {
  decide.mutate({ action: "confirm", basedOn: props.attribution.basedOn! });
}
function startChoosing() {
  decide.reset();
  driverId.value = "";
  note.value = "";
  choosing.value = true;
}
function saveChoice() {
  decide.mutate(
    { action: "correct", basedOn: props.attribution.basedOn!, driverId: driverId.value, note: note.value.trim() },
    { onSuccess: () => (choosing.value = false) },
  );
}
const canSave = computed(() => !!driverId.value && note.value.trim().length > 0 && !decide.isPending.value);
</script>

<template>
  <BaseCard data-test="driver-card">
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="text-sm font-semibold text-ink">Driver</h2>
      <span v-if="badge" :class="[BADGE_BASE, toneClass(badge.tone)]" data-test="driver-badge">{{ badge.text }}</span>
    </div>

    <p v-if="!reading" class="mt-3 text-sm text-ink-muted" data-test="driver-pending">
      Samsara has not been read for this inspection yet. The newest inspections are read first, 25 an hour.
    </p>

    <template v-else>
      <div class="mt-3 space-y-1 text-sm" data-test="driver-reading">
        <p v-if="reading.samsaraDriver" class="text-ink">
          <BaseButton v-if="driverLink(reading.driver)" variant="link" :to="driverLink(reading.driver)!">{{ reading.driver!.name }}</BaseButton>
          <span v-else-if="reading.driver" class="font-medium">{{ reading.driver.name }}</span>
          <template v-else>
            <span class="font-medium">{{ reading.samsaraDriver.name ?? "A Samsara driver" }}</span>
            <span class="text-ink-muted"> — in Samsara, not on our roster</span>
          </template>
          <span v-if="reading.basis" class="text-ink-muted">, {{ ATTRIBUTION_BASIS_TEXT[reading.basis] }}.</span>
        </p>
        <p v-else class="text-ink">{{ ATTRIBUTION_OUTCOME_TEXT[reading.outcome] }}</p>
        <ul v-if="reading.outcome === 'several_drivers' && reading.candidates.length" class="list-disc pl-5 text-ink-muted" data-test="driver-candidates">
          <li v-for="c in reading.candidates" :key="c.samsaraDriverId">
            {{ c.driver?.name ?? c.name ?? "A Samsara driver" }}<template v-if="!c.driver"> (not on our roster)</template><template v-if="c.passenger"> — co-driver</template>
          </li>
        </ul>
        <p v-if="question" class="font-medium text-warning-700" data-test="driver-question">{{ question.text }}</p>
        <!-- The GPS and the clock are how the reading was made: in the open while the card asks, one click
             away once it is the answer. -->
        <component :is="question ? 'div' : 'details'" class="space-y-1">
          <summary v-if="!question" class="cursor-pointer text-xs font-medium text-ink-muted">How Samsara read it</summary>
          <p class="text-ink-muted" data-test="driver-location">{{ ATTRIBUTION_LOCATION_TEXT[reading.locationCheck] }}</p>
          <p v-if="when" class="text-ink-muted" data-test="driver-when">Inspected {{ when }} ({{ ATTRIBUTION_ZONE_TEXT[reading.zoneMethod] }}).</p>
        </component>
      </div>

      <div v-if="decision" class="mt-4 border-t border-edge pt-4 text-sm" data-test="driver-decision">
        <p class="text-ink">
          <template v-if="decision.kind === 'confirmed'">Confirmed</template>
          <template v-else-if="decision.kind === 'confirmed_by_report'">
            Confirmed by the officer's report:
            <BaseButton v-if="driverLink(decision.driver)" variant="link" :to="driverLink(decision.driver)!">{{ decision.driver!.name }}</BaseButton>
            <span v-else class="font-medium">{{ decision.driver?.name ?? "a driver record that has since been merged" }}</span>
            holds the licence on the report, and Samsara put them on the truck
          </template>
          <template v-else>
            Corrected to
            <BaseButton v-if="driverLink(decision.driver)" variant="link" :to="driverLink(decision.driver)!">{{ decision.driver!.name }}</BaseButton>
            <span v-else class="font-medium">{{ decision.driver?.name ?? "a driver record that has since been merged" }}</span>
          </template>
          <template v-if="decision.kind === 'confirmed_by_report'"> on {{ formatDateTime(decision.decidedAt) }}.</template>
          <template v-else> by {{ decision.decidedBy ?? "a former user" }} on {{ formatDateTime(decision.decidedAt) }}.</template>
        </p>
        <p v-if="decision.note" class="mt-1 text-ink-muted">“{{ decision.note }}”</p>
        <p v-if="decision.engineVersion !== reading.engineVersion" class="mt-1 text-xs text-ink-tertiary" data-test="driver-decision-older">
          Decided over an earlier reading. Samsara has been read again since; the reading above is the new one.
        </p>
      </div>

      <div v-if="reports.length" class="mt-4 space-y-3 border-t border-edge pt-4 text-sm" data-test="driver-reports">
        <div v-for="r in reports" :key="r.documentId" data-test="driver-report">
          <p class="text-ink">
            <span class="font-medium">Officer's report</span>
            <span :class="['ml-2', BADGE_BASE, toneClass(REPORT_TONE[r.state === 'checked' ? r.outcome! : r.state])]">{{ reportLabel(r) }}</span>
          </p>
          <p v-if="r.nameOnReport || r.licenceLast4" class="mt-1 text-ink-muted">
            <template v-if="r.nameOnReport">Names {{ r.nameOnReport }}</template><template v-if="r.licenceLast4">{{ r.nameOnReport ? ", licence" : "Licence" }} ending {{ r.licenceLast4 }}</template><template v-if="r.driver"> — on our roster as {{ r.driver.name }}</template>.
          </p>
          <ul v-if="r.reasons.length" class="mt-1 list-disc pl-5 text-ink-muted" data-test="driver-report-reasons">
            <li v-for="reason in r.reasons" :key="reason.code">{{ reason.text }}</li>
          </ul>
        </div>
      </div>

      <div v-if="canDecide && !choosing && question" class="mt-4 flex flex-wrap gap-2" data-test="driver-actions">
        <BaseButton v-if="canConfirm" variant="primary" :disabled="decide.isPending.value" data-test="driver-confirm" @click="confirm">Confirm this driver</BaseButton>
        <BaseButton :variant="canConfirm ? 'secondary' : 'primary'" data-test="driver-choose" @click="startChoosing">
          {{ reading.outcome === "one_driver" ? "Choose a different driver" : "Choose the driver" }}
        </BaseButton>
      </div>
      <div v-else-if="canDecide && !choosing" class="mt-3" data-test="driver-actions">
        <BaseButton variant="link" data-test="driver-choose" @click="startChoosing">Not right? Choose a different driver</BaseButton>
      </div>

      <form v-if="choosing" class="mt-4 space-y-3 border-t border-edge pt-4" data-test="driver-form" @submit.prevent="saveChoice">
        <FormField v-slot="{ id }" label="Driver" required>
          <ComboSelect :id="id" v-model="driverId" :options="driverOptions" placeholder="Search drivers, former ones included…" />
        </FormField>
        <FormField v-slot="{ id }" label="What shows it was this driver" required>
          <BaseTextarea :id="id" v-model="note" maxlength="1000" placeholder="For example: the driver's name on the inspection report, or the paper log." />
        </FormField>
        <div class="flex gap-2">
          <BaseButton variant="primary" type="submit" :disabled="!canSave" data-test="driver-save">Save</BaseButton>
          <BaseButton @click="choosing = false">Cancel</BaseButton>
        </div>
      </form>

      <p v-if="failure" class="mt-3 text-sm text-danger-700" role="alert" data-test="driver-error">{{ failure }}</p>
    </template>
  </BaseCard>
</template>
