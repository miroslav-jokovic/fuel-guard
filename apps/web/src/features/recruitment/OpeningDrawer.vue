<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AD_MONEY_PER, OPENING_BENEFIT_TERMS, OPENING_BONUS_KINDS, OPENING_EQUIPMENT, OPENING_SCHEDULES, adAreaSchema, type OpeningView, type PlaceSuggestion } from "@silvicom/shared";
import {
  AppButton as BaseButton,
  AppCallout,
  AppCheckbox as BaseCheckbox,
  AppDateField,
  AppFormField as FormField,
  AppInput as BaseInput,
  AppSelect,
  AppTextarea,
} from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { useToastStore } from "@/stores/toast";
import { BONUS_KIND_LABEL, EQUIPMENT_LABEL, PAY_PER_LABEL, SCHEDULE_LABEL, benefitLabel, blankOpeningForm, openingFormFrom, openingSaveFrom, type OpeningForm } from "./openingForm";
import OpeningProfileStep from "./OpeningProfileStep.vue";
import PlaceSearchField from "./PlaceSearchField.vue";
import { useSaveOpening } from "./useOpenings";

/**
 * Make an opening, or the next version of one (Q-AD43 (b); the owner's G4). A saved version is never changed:
 * saving adds a version, and an ad keeps the version it was made from, which is why the button says what it does
 * (the brand kit drawer's rule). Fields and bounds are `openingSaveSchema`'s; the radius limits are read from
 * `adAreaSchema` for the hint, so the words cannot drift from the rule.
 */
const props = defineProps<{ open: boolean; opening: OpeningView | null; canManage: boolean }>();
const emit = defineEmits<{ close: [] }>();

const FORM = "opening-form";
const radius = adAreaSchema.shape.radius_miles;
const RADIUS_HINT = `Between ${radius.minValue} and ${radius.maxValue} miles of the point.`;
const payPer = AD_MONEY_PER.map((p) => ({ value: p, label: PAY_PER_LABEL[p] }));
const schedules = [{ value: "", label: "Not said" }, ...OPENING_SCHEDULES.map((s) => ({ value: s, label: SCHEDULE_LABEL[s] }))];
const bonusKinds = [{ value: "", label: "No bonus" }, ...OPENING_BONUS_KINDS.map((k) => ({ value: k, label: BONUS_KIND_LABEL[k] }))];

const toast = useToastStore();
const save = useSaveOpening();
const form = ref<OpeningForm>(blankOpeningForm());
const refusal = ref<string | null>(null);
const nextVersion = computed(() => (props.opening?.current?.version ?? 0) + 1);

watch(() => props.open, (open) => {
  if (!open) return;
  refusal.value = null;
  form.value = props.opening ? openingFormFrom(props.opening) : blankOpeningForm();
}, { immediate: true });

function pickPlace(place: PlaceSuggestion): void {
  form.value.area_point = { latitude: place.lat, longitude: place.lng };
  form.value.area_label = place.label.slice(0, 120);
}

function toggleEquipment(e: OpeningForm["equipment"][number], on: boolean): void {
  const rest = form.value.equipment.filter((x) => x !== e);
  form.value.equipment = on ? [...rest, e] : rest;
}

function toggleBenefit(key: string, on: boolean): void {
  const rest = form.value.benefits.filter((x) => x !== key);
  form.value.benefits = on ? [...rest, key] : rest;
}

async function submit(): Promise<void> {
  const ask = openingSaveFrom(form.value, props.opening?.id ?? null);
  if (!ask.ok) {
    refusal.value = ask.message;
    return;
  }
  refusal.value = null;
  try {
    const saved = await save.mutateAsync(ask.save);
    toast.success(saved.version === 1 ? "Opening saved" : `Saved as version ${saved.version}`);
    emit("close");
  } catch (e) {
    toast.error("Could not save the opening", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <SlideOver :open="open" :title="opening?.current ? `Edit ${opening.current.title}` : 'New opening'" description="Ads made earlier keep the version they were made from." size="lg" @close="emit('close')">
    <form :id="FORM" class="space-y-6" novalidate data-test="opening-form" @submit.prevent="submit">
      <OpeningProfileStep v-model="form.profile_version_id" :can-manage="canManage" />

      <FormField v-slot="{ id }" label="Title" hint="What the ad advertises, in plain words." required>
        <BaseInput :id="id" v-model="form.title" placeholder="Class A regional driver" data-test="opening-title" />
      </FormField>
      <FormField v-slot="{ id }" label="Drivers wanted" hint="Leave empty if there is no set number.">
        <BaseInput :id="id" v-model="form.headcount" type="number" inputmode="numeric" class="w-32" />
      </FormField>

      <fieldset class="space-y-2">
        <legend class="text-sm font-semibold text-ink">Pay</legend>
        <p class="text-sm text-ink-muted">In dollars. An ad may state only these figures.</p>
        <div class="grid gap-3 sm:grid-cols-3">
          <FormField v-slot="{ id }" label="Pay basis" required><AppSelect :id="id" v-model="form.pay_per" :options="payPer" /></FormField>
          <FormField v-slot="{ id }" label="Pay from" required><BaseInput :id="id" v-model="form.pay_min" inputmode="decimal" data-test="pay-min" /></FormField>
          <FormField v-slot="{ id }" label="Pay up to"><BaseInput :id="id" v-model="form.pay_max" inputmode="decimal" data-test="pay-max" /></FormField>
        </div>
      </fieldset>

      <FormField v-slot="{ id }" label="Home time" hint="As the ad may promise it, e.g. Home weekly." required>
        <BaseInput :id="id" v-model="form.home_time" data-test="home-time" />
      </FormField>
      <fieldset class="space-y-2">
        <legend class="text-sm font-semibold text-ink">Equipment</legend>
        <div class="flex flex-wrap gap-x-6 gap-y-2">
          <BaseCheckbox v-for="e in OPENING_EQUIPMENT" :key="e" :model-value="form.equipment.includes(e)" :label="EQUIPMENT_LABEL[e]" :data-test="`equipment-${e}`" @update:model-value="(on: boolean) => toggleEquipment(e, on)" />
        </div>
      </fieldset>
      <FormField v-slot="{ id }" label="Lanes" hint="Optional, e.g. Midwest to the Southeast.">
        <BaseInput :id="id" v-model="form.lanes" />
      </FormField>
      <FormField v-slot="{ id }" label="Schedule" hint="How the work runs. The ad may describe it, not promise it.">
        <AppSelect :id="id" v-model="form.schedule" :options="schedules" data-test="schedule" />
      </FormField>
      <FormField v-slot="{ id }" label="Start date">
        <AppDateField :id="id" v-model="form.start_date" />
      </FormField>

      <fieldset class="space-y-2">
        <legend class="text-sm font-semibold text-ink">Benefits and features</legend>
        <p class="text-sm text-ink-muted">An ad may promise only what is ticked here.</p>
        <div class="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <BaseCheckbox v-for="b in OPENING_BENEFIT_TERMS" :key="b" :model-value="form.benefits.includes(b)" :label="benefitLabel(b)" :data-test="`benefit-${b.replace(/\W+/g, '-')}`" @update:model-value="(on: boolean) => toggleBenefit(b, on)" />
        </div>
      </fieldset>

      <fieldset class="space-y-2">
        <legend class="text-sm font-semibold text-ink">Bonus</legend>
        <p class="text-sm text-ink-muted">In dollars. The ad may state this amount and nothing else as a bonus.</p>
        <div class="grid gap-3 sm:grid-cols-2">
          <FormField v-slot="{ id }" label="Kind"><AppSelect :id="id" v-model="form.bonus_kind" :options="bonusKinds" data-test="bonus-kind" /></FormField>
          <FormField v-slot="{ id }" label="Amount"><BaseInput :id="id" v-model="form.bonus_amount" inputmode="decimal" :disabled="form.bonus_kind === ''" data-test="bonus-amount" /></FormField>
        </div>
      </fieldset>

      <FormField v-slot="{ id }" label="In our words" hint="One line about driving here, as you would say it. Figures and promises must match the fields above.">
        <AppTextarea :id="id" v-model="form.in_our_words" rows="2" maxlength="140" data-test="in-our-words" />
      </FormField>

      <fieldset class="space-y-3">
        <legend class="text-sm font-semibold text-ink">Hiring area</legend>
        <p class="text-sm text-ink-muted">A point and a radius, never a ZIP list. Ads run only inside it.</p>
        <FormField v-slot="{ id }" label="Yard or town" required>
          <PlaceSearchField :id="id" @select="pickPlace" />
        </FormField>
        <p v-if="form.area_point" class="text-sm text-ink" data-test="area-picked">Picked: {{ form.area_label }}</p>
        <FormField v-if="form.area_point" v-slot="{ id }" label="Area name" hint="How the area reads to people here.">
          <BaseInput :id="id" v-model="form.area_label" data-test="area-label" />
        </FormField>
        <FormField v-slot="{ id }" label="Radius in miles" :hint="RADIUS_HINT" required>
          <BaseInput :id="id" v-model="form.radius_miles" type="number" inputmode="numeric" class="w-32" data-test="radius" />
        </FormField>
        <FormField v-slot="{ id }" label="Why this area" hint="Kept with the opening, for anyone who asks why the ad ran here." required>
          <AppTextarea :id="id" v-model="form.area_reason" rows="2" data-test="area-reason" />
        </FormField>
      </fieldset>
      <AppCallout v-if="refusal" tone="danger" data-test="opening-refusal">{{ refusal }}</AppCallout>
    </form>
    <template #footer>
      <div class="flex items-center justify-end gap-3">
        <BaseButton :disabled="save.isPending.value" @click="emit('close')">Cancel</BaseButton>
        <BaseButton v-if="canManage" variant="primary" type="submit" :form="FORM" :disabled="save.isPending.value" data-test="save-opening">
          {{ opening ? `Save as version ${nextVersion}` : "Save opening" }}
        </BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
