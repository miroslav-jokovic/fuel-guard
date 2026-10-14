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
  type AttributionDriverRefDto,
  type RoadsideAttributionDto,
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
  if (decision.value) return { text: decision.value.kind === "confirmed" ? "Confirmed by a person" : "Corrected by a person", tone: "brand" };
  if (!reading.value) return null;
  return reading.value.confidence === "high" ? { text: "Strong reading", tone: "success" } : { text: "Needs a person", tone: "warning" };
});

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
        <p class="text-ink-muted" data-test="driver-location">{{ ATTRIBUTION_LOCATION_TEXT[reading.locationCheck] }}</p>
        <p v-if="when" class="text-ink-muted" data-test="driver-when">Inspected {{ when }} ({{ ATTRIBUTION_ZONE_TEXT[reading.zoneMethod] }}).</p>
      </div>

      <div v-if="decision" class="mt-4 border-t border-edge pt-4 text-sm" data-test="driver-decision">
        <p class="text-ink">
          <template v-if="decision.kind === 'confirmed'">Confirmed</template>
          <template v-else>
            Corrected to
            <BaseButton v-if="driverLink(decision.driver)" variant="link" :to="driverLink(decision.driver)!">{{ decision.driver!.name }}</BaseButton>
            <span v-else class="font-medium">{{ decision.driver?.name ?? "a driver record that has since been merged" }}</span>
          </template>
          by {{ decision.decidedBy ?? "a former user" }} on {{ formatDateTime(decision.decidedAt) }}.
        </p>
        <p v-if="decision.note" class="mt-1 text-ink-muted">“{{ decision.note }}”</p>
        <p v-if="decision.engineVersion !== reading.engineVersion" class="mt-1 text-xs text-ink-tertiary" data-test="driver-decision-older">
          Decided over an earlier reading. Samsara has been read again since; the reading above is the new one.
        </p>
      </div>

      <div v-if="canDecide && !choosing" class="mt-4 flex flex-wrap gap-2" data-test="driver-actions">
        <BaseButton v-if="canConfirm" variant="primary" :disabled="decide.isPending.value" data-test="driver-confirm" @click="confirm">Confirm this driver</BaseButton>
        <BaseButton data-test="driver-choose" @click="startChoosing">
          {{ reading.outcome === "one_driver" || decision ? "Choose a different driver" : "Choose the driver" }}
        </BaseButton>
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
