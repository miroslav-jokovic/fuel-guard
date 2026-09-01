<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  AppCombobox as ComboSelect,
  AppFormField as FormField,
  AppInput as BaseInput,
} from "@silvicom/ui";

/**
 * The two header values on the printed form that nothing could capture until now.
 *
 * ── WHY THEY ARE A COMPONENT AND NOT TWO INPUTS ON A PAGE ──────────────────────────────────────
 * They are wanted in two places for two different reasons, and a second editor is how a field
 * acquires a second amount of honesty (the lesson `lint:capabilities` was written for). The decal
 * serial is read off the sticker in the report set the inspector is holding, so it belongs on the
 * drawer that opens the report — but a decal is sometimes applied at the end of the job, so it also
 * has to be editable on the report itself while the report is still a draft. Same for the agency
 * line. One component, two mounts.
 *
 * ── THE DECAL SERIAL IS THE FORM'S "REPORT NUMBER" BOX ─────────────────────────────────────────
 * Measured from the office's own filed reports — `610685784` on trailer 535968 (08/2026),
 * `610641628` on tractor 654 (06/2026). It is the serial of the §396.17(c)(2) decal that ships with
 * the report set and goes on the vehicle, so it is often the ONLY on-vehicle proof the inspection
 * happened: it is what turns the sticker an officer reads at a roadside into the report the carrier
 * is obliged to produce (0281). It is unique per carrier — the API refuses a repeat by name.
 *
 * ── THE AGENCY LINE IS OPTIONAL ON THE FORM, AND USUALLY BLANK ─────────────────────────────────
 * The blank Keller page labels it "INSPECTION AGENCY/LOCATION (OPTIONAL)", and both filed samples
 * leave it EMPTY — correctly, because their own technician did the work and the MOTOR CARRIER
 * OPERATOR block directly above it already reads SILVICOM INC / 1301 ARMITAGE AVE / MELROSE PARK IL.
 * So "our own technician" is the default and it prints nothing. The fields appear only for the case
 * the carrier does not yet have but the regulation allows: a dealer or shop doing the inspection.
 *
 * ── WHY "LOCATION" ASKS FOR A CITY AND NOT A STREET ────────────────────────────────────────────
 * The cell is 158 pt wide and the renderer shrinks to fit with a 5.5 pt floor. Measured against
 * pdf-lib's Helvetica: "PETERBILT OF CHICAGO, MELROSE PARK IL" (37 chars) settles at 7.25 pt and
 * fits; a company plus a full street address (61 chars) is 189 pt at the floor and **overflows the
 * cell**. About 47 characters is the practical ceiling. The form asks for a LOCATION, so a city and
 * state is both what it wants and what fits — the hint says so rather than silently truncating.
 */

const props = withDefaults(
  defineProps<{
    decalSerial: string | null;
    /** The single line the form has, as stored. Split for editing, rejoined on change. */
    agency: string | null;
    /** Named on the in-house option, so the reader sees what the report will actually say. */
    carrierName: string;
    disabled?: boolean;
  }>(),
  { disabled: false },
);
const emit = defineEmits<{
  "update:decalSerial": [value: string | null];
  "update:agency": [value: string | null];
}>();

/**
 * One stored line, two boxes.
 *
 * The column is one 200-character field because the form is one cell, and the office asked to enter
 * the company and the location separately. So the split is a presentation of the stored string, not
 * a second representation of it: joined with ", " and split back on the FIRST comma. Anything this
 * component wrote round-trips exactly; a value typed elsewhere with extra commas puts the remainder
 * in the location box, which is visible and harmless rather than lost.
 */
const performedBy = ref<"in_house" | "outside">(props.agency ? "outside" : "in_house");
const company = ref("");
const location = ref("");

watch(
  () => props.agency,
  (line) => {
    if (!line) {
      company.value = "";
      location.value = "";
      return;
    }
    performedBy.value = "outside";
    const comma = line.indexOf(",");
    company.value = comma === -1 ? line : line.slice(0, comma).trim();
    location.value = comma === -1 ? "" : line.slice(comma + 1).trim();
  },
  { immediate: true },
);

function pushAgency() {
  if (performedBy.value === "in_house") {
    emit("update:agency", null);
    return;
  }
  const line = [company.value.trim(), location.value.trim()].filter(Boolean).join(", ");
  emit("update:agency", line || null);
}

function onPerformedByChange(next: string) {
  performedBy.value = next === "outside" ? "outside" : "in_house";
  if (performedBy.value === "in_house") {
    company.value = "";
    location.value = "";
  }
  pushAgency();
}

/**
 * Measured, not guessed — see the header. It is carried in the HINT rather than as an error or a
 * warning paragraph, and that is deliberate twice over: the design system has no "warning on a
 * field" primitive and a feature folder is not where one gets invented, and more importantly this is
 * NOT an error. The renderer shrinks to a 5.5 pt floor, so an over-long line still prints — just
 * smaller, and eventually past the edge of the cell. Telling the office the budget and the current
 * count lets them decide; `error` would colour it red and claim a refusal that never comes.
 */
const AGENCY_LINE_FITS = 47;
const agencyLine = computed(() =>
  performedBy.value === "outside"
    ? [company.value.trim(), location.value.trim()].filter(Boolean).join(", ")
    : "",
);
const locationHint = computed(() =>
  agencyLine.value.length > AGENCY_LINE_FITS
    ? `City and state. About ${AGENCY_LINE_FITS} characters fit on the line and this is ${agencyLine.value.length} — it will print smaller.`
    : "City and state. It prints on one line beside the inspector's name, so it has to be short.",
);
</script>

<template>
  <div class="space-y-6">
    <section aria-labelledby="inspection-decal">
      <h3 id="inspection-decal" class="text-sm font-semibold text-ink">The decal</h3>
      <p class="mt-1 text-sm text-ink-muted">
        The number on the sticker that came with this report set and goes on the vehicle. It is what
        connects the sticker to this report if anybody asks.
      </p>
      <div class="mt-4 space-y-4">
        <FormField v-slot="{ id }" label="Sticker number" hint="Prints in the report number box, top right.">
          <BaseInput
            :id="id"
            :model-value="decalSerial ?? ''"
            :disabled="disabled"
            class="font-mono"
            placeholder="610685784"
            inputmode="numeric"
            @update:model-value="emit('update:decalSerial', $event.trim() || null)"
          />
        </FormField>
      </div>
    </section>

    <section aria-labelledby="inspection-agency">
      <h3 id="inspection-agency" class="text-sm font-semibold text-ink">Who performed it</h3>
      <div class="mt-4 space-y-4">
        <FormField v-slot="{ id }" label="Performed by">
          <ComboSelect
            :id="id"
            :model-value="performedBy"
            :disabled="disabled"
            :options="[
              { value: 'in_house', label: `${carrierName} — our own technician` },
              { value: 'outside', label: 'An outside shop' },
            ]"
            @update:model-value="onPerformedByChange"
          />
        </FormField>

        <template v-if="performedBy === 'outside'">
          <FormField v-slot="{ id }" label="Company">
            <BaseInput
              :id="id"
              v-model="company"
              :disabled="disabled"
              placeholder="Peterbilt of Chicago"
              @blur="pushAgency"
            />
          </FormField>
          <FormField v-slot="{ id }" label="Location" :hint="locationHint">
            <BaseInput
              :id="id"
              v-model="location"
              :disabled="disabled"
              placeholder="Melrose Park IL"
              @blur="pushAgency"
            />
          </FormField>
        </template>
      </div>
    </section>
  </div>
</template>
