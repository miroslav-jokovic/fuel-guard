<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { EFS_MILEAGE_MAX, type EfsMileageCode } from "@fuelguard/shared";
// `AppCombobox`, aliased the way every other call site aliases it. There is no
// `components/ui/ComboSelect.vue` — DESIGN-SYSTEM-CONTRACT.md names one and is stale here, and
// `vue-tsc` does NOT catch the bad path because `*.vue` resolves through a module shim. Only the
// build does; it failed on exactly this.
import {
  AppButton as BaseButton,
  AppCombobox as ComboSelect,
  AppInput as BaseInput,
  AppFormField as FormField,
  AppRadioGroup,
} from "@fuelguard/ui";
import SlideOver from "@/components/SlideOver.vue";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { landingNotice, useUnitMileage } from "./useUnitMileage";

/**
 * Correct the odometer reading EFS holds for one truck (`docs/37` §6 E′).
 *
 * ── What this is, and the three things it deliberately is NOT ───────────────────────────────────
 * It mirrors the WEX portal's own Override Mileage screen and nothing more. Miki's framing, and the
 * reason the first design was thrown away: *"we are not building EFS SecureFuel, we are just adding
 * options from our system to override"*. So:
 *
 *   • **No drift comparison.** An earlier draft showed our Samsara reading beside EFS's with the gap
 *     between them. The API still returns those fields; this screen does not read them. Whether the
 *     two agree is EFS's business at the pump, not a number we should be teaching operators to act
 *     on — and §7 Q1 means we could not honestly explain what a given gap implies anyway.
 *   • **No fleet list.** This answers "correct this truck", which is the task. Which trucks need
 *     correcting is a question EFS answers by declining a fuelling.
 *   • **No card.** The operation targets a UNIT. It is on the fuel-cards page because that is where
 *     EFS lives in this product, not because it belongs to a card.
 *
 * ── The unit is CHOSEN from our fleet, not typed ────────────────────────────────────────────────
 * A free-text unit box shipped briefly and produced the obvious failure the same day: `991` typed
 * against QA, refused with "No vehicle in this company has unit number 991", and no way to see what
 * the valid units were. The write already required the unit to be one of this company's trucks —
 * that is the typo boundary, and `overrideLastMileage` returns nothing that would say the reading
 * landed on the wrong truck — so the field may as well only offer trucks that pass it.
 *
 * This is NOT the look-up step that was removed. That one read EFS's stored mileage and displayed
 * it; this reads our own vehicle list to answer "which truck", which is the question the portal's
 * own Card Lookup screen asks first. Choosing an entity is not displaying vendor data.
 *
 * ── It shows NO reading before the write, and that was a correction ─────────────────────────────
 * The first version looked the unit up first and displayed what EFS held, on the argument that it is
 * the value being overwritten rather than a comparison. Miki's ruling, 2026-08-17: *"we dont need to
 * display this data, we are mirroring features not recreating EFS SecureFuel."* The distinction that
 * matters is not comparison-vs-state, it is that an operator here already knows the number they
 * intend to set — they are correcting a reading they got from Samsara or from the truck, not
 * browsing EFS. A lookup step made them wait for a value they were about to replace.
 *
 * What survives is the OUTCOME, which is not a data display: `overrideLastMileage` returns nothing,
 * so `before → after` is the only evidence the write landed, and it comes from the API's verifying
 * re-read after the fact rather than from a screen the operator had to drive first.
 *
 * ── The result panel is the whole point ─────────────────────────────────────────────────────────
 * `overrideLastMileage` returns NOTHING (§3) — no result, no document, not even an empty element.
 * A screen that showed a success toast on a 200 would be reporting the vendor's willingness to
 * accept a request as though the reading had changed, which is the H1 failure this codebase has
 * already paid for once. Every sentence here comes from the API's verifying re-read, and all four
 * landings get their own wording in `landingNotice` — including the two nobody wants.
 */

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const { outcome, saving, error, override, reset } = useUnitMileage();

const vehicles = useVehiclesQuery();

/**
 * Only trucks with a unit number, since that is what EFS is keyed on. A vehicle without one cannot
 * be the subject of this operation at all, and offering it would produce a refusal we can prevent.
 */
const unitOptions = computed(() => (vehicles.data.value ?? [])
  .filter((v) => (v.unit_number ?? "").trim() !== "")
  .map((v) => ({
    value: v.unit_number as string,
    label: [v.unit_number, v.make, v.model].filter(Boolean).join(" · "),
  })));

const unit = ref("");
const code = ref<EfsMileageCode>("ODRD");
const mileage = ref("");

/** The wire codes, with the labels the portal shows. `ODRD`/`HBRD` never reach an operator's eyes. */
const CODE_OPTIONS = [
  { value: "ODRD", label: "Odometer" },
  { value: "HBRD", label: "Hubometer" },
];

/** A fresh drawer every time. A unit left in the box from a previous correction is how the right
 *  number reaches the wrong truck. */
watch(() => props.open, (isOpen) => {
  if (!isOpen) return;
  unit.value = "";
  code.value = "ODRD";
  mileage.value = "";
  reset();
});

/** A result belongs to the unit and code that produced it — clear it the moment either changes,
 *  so an outcome never sits under a different truck's number. */
watch([unit, code], () => {
  if (outcome.value) reset();
});

const trimmedUnit = computed(() => unit.value.trim());

const parsedMileage = computed(() => {
  const raw = mileage.value.trim();
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 && n <= EFS_MILEAGE_MAX ? n : null;
});

/**
 * Why the bound is stated rather than the field silently clamped: a clamp turns a fat-fingered
 * extra digit into a plausible number the operator never questions, and the vendor field is an
 * `xsd:int` that would take 2.1 billion without complaint (`EFS_MILEAGE_MAX`).
 */
const mileageError = computed(() => {
  const raw = mileage.value.trim();
  if (raw === "") return undefined;
  if (!/^\d+$/.test(raw)) return "Whole miles only — no decimals, commas or letters.";
  if (parsedMileage.value === null) return `That is above ${EFS_MILEAGE_MAX.toLocaleString()} miles, which is not a truck.`;
  return undefined;
});

const canSubmit = computed(() =>
  trimmedUnit.value.length > 0 && parsedMileage.value !== null && !saving.value);

const notice = computed(() => (outcome.value ? landingNotice(outcome.value) : null));

const NOTICE_CLASS: Record<string, string> = {
  success: "bg-success-50 text-success-800 ring-success-600/20",
  info: "bg-brand-50 text-brand-800 ring-brand-600/20",
  warning: "bg-warning-50 text-warning-800 ring-warning-600/20",
  error: "bg-danger-50 text-danger-800 ring-danger-600/20",
};

async function submit(): Promise<void> {
  if (parsedMileage.value === null) return;
  await override(trimmedUnit.value, code.value, parsedMileage.value);
}
</script>

<template>
  <SlideOver
    :open="open"
    title="Override mileage"
    description="Correct the odometer reading EFS holds for a truck. This changes EFS's copy only."
    size="lg"
    @close="emit('close')"
  >
    <div class="space-y-5">
      <!-- ── Which truck ─────────────────────────────────────────────────────────────────────── -->
      <div class="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Truck"
          :hint="unitOptions.length === 0 && !vehicles.isLoading.value
            ? 'No vehicle in this company has a unit number, so there is nothing EFS can be keyed to.'
            : 'The unit number EFS holds the reading against.'"
        >
          <template #default="{ id }">
            <ComboSelect
              :id="id"
              v-model="unit"
              :options="unitOptions"
              :disabled="saving || vehicles.isLoading.value"
              :placeholder="vehicles.isLoading.value ? 'Loading trucks…' : 'Choose a truck…'"
            />
          </template>
        </FormField>

        <!-- Its own `legend`, not a FormField label: AppRadioGroup renders one already, with the
             same classes, so nesting the two prints the label twice. -->
        <AppRadioGroup v-model="code" legend="Reading" :options="CODE_OPTIONS" />
      </div>

      <!-- ── The correction ──────────────────────────────────────────────────────────────────── -->
      <FormField
        label="New reading"
        :error="mileageError"
        :hint="mileageError ? undefined : 'Whole miles. This replaces the value above.'"
      >
        <template #default="{ id }">
          <BaseInput
            :id="id"
            v-model="mileage"
            inputmode="numeric"
            autocomplete="off"
            :invalid="Boolean(mileageError)"
            placeholder="258900"
          />
        </template>
      </FormField>

      <!--
        Said before the button, not after the write. This is the one claim about this operation an
        operator is most likely to get wrong, and §6a E′ is explicit: it seeds EFS's copy, it does
        not touch the truck, Samsara, or our own odometer.
      -->
      <p class="text-sm text-ink-muted">
        This changes only the reading EFS compares the driver's pump entry against. It does not
        change the truck's real odometer or anything we hold.
      </p>

      <p v-if="error" class="text-sm text-danger-600">{{ error }}</p>

      <!-- ── What actually happened ──────────────────────────────────────────────────────────── -->
      <div v-if="notice" class="rounded-md p-4 text-sm ring-1" :class="NOTICE_CLASS[notice.tone]">
        <p class="font-semibold">{{ notice.title }}</p>
        <p class="mt-1">{{ notice.detail }}</p>
        <p v-if="outcome?.dispatched" class="mt-2 tabular-nums opacity-80">
          {{ outcome.before === null ? "no reading" : `${outcome.before.toLocaleString()} mi` }}
          →
          {{ outcome.after === null ? "no reading" : `${outcome.after.toLocaleString()} mi` }}
        </p>
      </div>
    </div>

    <template #footer>
      <BaseButton variant="secondary" :disabled="saving" @click="emit('close')">Close</BaseButton>
      <BaseButton variant="primary" :disabled="!canSubmit" @click="submit">
        {{ saving ? "Sending…" : "Override mileage" }}
      </BaseButton>
    </template>
  </SlideOver>
</template>
