<script setup lang="ts">
import { reactive, ref } from "vue";
import {
  AppButton as BaseButton,
  AppCombobox as ComboSelect,
  AppFormField as FormField,
  AppInput as BaseInput,
  AppMemorableDate,
} from "@silvicom/ui";
import { jurisdictionName, jurisdictionOptions } from "@silvicom/shared";
import YesNoField from "@/features/apply/YesNoField.vue";
import { validateOtherLicence, type OtherLicence, type PartOneAnswers, type ScreenErrors } from "./partOneScreens";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * Screen 6 (§6.2): every other licence held in three years — a yes/no gate first, then an add-another
 * loop, one licence at a time. The MVR is ordered per jurisdiction from this list (D-AW3, AW7), so a
 * "Yes" with nothing added is refused rather than read as "No".
 *
 * The entry being typed lives here until "Add this licence" checks it (state and number required, a
 * duplicate refused in words before 0376's unique index could answer 23505); only then does it join the
 * answers `usePartOne` posts.
 */
defineProps<{ errors: ScreenErrors }>();
const answers = defineModel<PartOneAnswers>("answers", { required: true });
const copy = APPLY_COPY.partOne.otherLicences;
const JURISDICTIONS = jurisdictionOptions();

const blankEntry = (): OtherLicence => ({ state_code: "", agency: "", licence_number: "", expires_on: "" });
const entry = reactive(blankEntry());
const adding = ref(false);
const entryErrors = ref<ScreenErrors>({});

function add(): void {
  const found = validateOtherLicence(entry, answers.value);
  entryErrors.value = found;
  if (Object.keys(found).length > 0) return;
  answers.value.others.push({ ...entry });
  Object.assign(entry, blankEntry());
  adding.value = false;
}

function remove(i: number): void {
  answers.value.others.splice(i, 1);
}

function cancel(): void {
  Object.assign(entry, blankEntry());
  [entryErrors.value, adding.value] = [{}, false];
}
</script>

<template>
  <div class="space-y-4">
    <YesNoField v-model="answers.otherHeld" :legend="copy.question" :hint="copy.hint" :error="errors.otherHeld" />

    <template v-if="answers.otherHeld">
      <div v-if="answers.others.length > 0">
        <h2 class="text-sm font-semibold text-ink">{{ copy.listHeading }}</h2>
        <ul class="mt-2 space-y-2">
          <li
            v-for="(l, i) in answers.others"
            :key="`${l.state_code}-${l.licence_number}`"
            class="flex items-center justify-between gap-3 rounded-surface bg-surface-muted p-3"
          >
            <span class="text-sm text-ink">{{ copy.entry(jurisdictionName(l.state_code) ?? l.state_code, l.licence_number) }}</span>
            <BaseButton variant="ghost" @click="remove(i)">{{ copy.remove }}</BaseButton>
          </li>
        </ul>
      </div>

      <div v-if="adding" class="space-y-4 rounded-surface bg-surface-muted p-4">
        <FormField id="p1-other-state" :label="copy.state" :error="entryErrors.state_code">
          <template #default="f"><ComboSelect v-bind="f" v-model="entry.state_code" :options="JURISDICTIONS" /></template>
        </FormField>
        <FormField id="p1-other-agency" :label="copy.agency" :error="entryErrors.agency">
          <template #default="f"><BaseInput v-bind="f" v-model="entry.agency" /></template>
        </FormField>
        <FormField id="p1-other-number" :label="copy.number" :error="entryErrors.licence_number">
          <template #default="f"><BaseInput v-bind="f" v-model="entry.licence_number" autocomplete="off" /></template>
        </FormField>
        <FormField id="p1-other-expires" :label="copy.expiresOn" :error="entryErrors.expires_on">
          <template #default="f"><AppMemorableDate v-bind="f" v-model="entry.expires_on" /></template>
        </FormField>
        <div class="flex gap-2">
          <BaseButton variant="secondary" @click="add">{{ copy.save }}</BaseButton>
          <BaseButton variant="ghost" @click="cancel">{{ copy.cancel }}</BaseButton>
        </div>
      </div>
      <BaseButton v-else variant="secondary" @click="adding = true">
        {{ answers.others.length > 0 ? copy.addAnother : copy.add }}
      </BaseButton>
    </template>
  </div>
</template>
