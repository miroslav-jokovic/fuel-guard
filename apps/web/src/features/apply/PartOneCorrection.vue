<script setup lang="ts">
import { computed, reactive, ref, toRef, watch } from "vue";
import {
  AppButton as BaseButton,
  AppCombobox as ComboSelect,
  AppDateField,
  AppFormField as FormField,
  AppInput as BaseInput,
  AppSelect,
} from "@silvicom/ui";
import {
  CDL_CLASSES,
  US_JURISDICTION_CODES,
  jurisdictionOptions,
  partOneCorrectionSchema,
  rolesThatManage,
  type PartOneFactsView,
} from "@silvicom/shared";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useCorrectPartOne } from "./useApplicationReview";

/**
 * The office correcting Part 1's facts (Q-AW36 (a), owner 2026-09-27) — the act the applicant's
 * "Something wrong? Tell us" asks for, beside the note that says it.
 *
 * ── THE WHOLE SET, PREFILLED ──────────────────────────────────────────────────────────────────
 * The form opens holding what Part 1 holds, the office changes what is wrong, and Save sends the lot:
 * the contact, the address, the CDL's class and every licence, the current CDL first. The server
 * overwrites through the applicant's own writer, so the list the MVR is ordered from, the licence PSP
 * ran on and what the application files cannot come apart.
 *
 * Not here, on purpose (the contract's header has why): the applicant's §40.25(j) and §382.301(b)
 * answers, the endorsements they declared, and the date of birth, which is corrected beside the
 * permissions as it always was.
 *
 * ⚠ `rolesThatManage("recruitment")`, the test the route applies. A reader sees no button.
 */
const props = defineProps<{ invitationId: string; facts: PartOneFactsView }>();

const session = useSessionStore();
const toast = useToastStore();
const correct = useCorrectPartOne(toRef(props, "invitationId"));

const canCorrect = computed(() => Boolean(session.role) && rolesThatManage("recruitment").includes(session.role!));
const JURISDICTIONS = jurisdictionOptions();
const US_STATES = JURISDICTIONS.filter((j) => US_JURISDICTION_CODES.has(j.value));
const CLASSES = CDL_CLASSES.map((c) => ({ value: c, label: `Class ${c}` }));

interface LicenceRow { state_code: string; agency: string; licence_number: string; expires_on: string }
const blankLicence = (): LicenceRow => ({ state_code: "", agency: "", licence_number: "", expires_on: "" });

const editing = ref(false);
const form = reactive({
  phone: "", address_line1: "", address_line2: "", city: "", state: "", postal_code: "", cdl_class: "",
  licences: [] as LicenceRow[],
});
const errors = ref<Record<string, string>>({});

function startEditing(): void {
  const { intake, licences } = props.facts;
  Object.assign(form, {
    phone: intake.phone ?? "",
    address_line1: intake.address_line1 ?? "",
    address_line2: intake.address_line2 ?? "",
    city: intake.city ?? "",
    state: intake.state ?? "",
    postal_code: intake.postal_code ?? "",
    cdl_class: intake.cdl_class ?? "",
    licences: [...licences]
      .sort((a, b) => a.position - b.position)
      .map((l) => ({ state_code: l.state_code, agency: l.agency ?? "", licence_number: l.licence_number, expires_on: l.expires_on ?? "" })),
  });
  if (form.licences.length === 0) form.licences.push(blankLicence());
  errors.value = {};
  editing.value = true;
}

// The drawer swaps applicants without unmounting; a half-typed correction must not carry over.
watch(() => props.invitationId, () => { editing.value = false; });

/** The body the contract takes: blanks are absent answers, and an empty second line clears it. */
const body = () => ({
  ...form,
  address_line2: form.address_line2.trim() === "" ? null : form.address_line2,
  licences: form.licences.map((l) => ({ ...l, agency: l.agency.trim() === "" ? null : l.agency })),
});

async function save(): Promise<void> {
  const parsed = partOneCorrectionSchema.safeParse(body());
  if (!parsed.success) {
    const next: Record<string, string> = {};
    for (const issue of parsed.error.issues) next[issue.path.join(".")] ??= issue.message;
    errors.value = next;
    return;
  }
  try {
    await correct.mutateAsync(parsed.data);
    editing.value = false;
    toast.success("The first part is corrected");
  } catch (e) {
    toast.error("Could not correct the first part", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <section class="space-y-3" data-part-one-correction>
    <div>
      <h3 class="text-sm font-semibold text-ink">What they gave at the start</h3>
      <p class="mt-1 text-xs text-ink-muted">
        Their phone, address and licences. A correction changes their record and what their
        application will say. Their answers to the drug and alcohol questions are theirs to give.
      </p>
    </div>

    <BaseButton v-if="!editing && canCorrect" size="sm" variant="secondary" @click="startEditing">
      Correct these
    </BaseButton>

    <div v-else-if="editing" class="space-y-4">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id="p1c-phone" label="Mobile phone" :error="errors.phone">
          <template #default="f"><BaseInput v-bind="f" v-model="form.phone" autocomplete="off" /></template>
        </FormField>
        <FormField id="p1c-class" label="CDL class" :error="errors.cdl_class">
          <template #default="f"><AppSelect v-bind="f" v-model="form.cdl_class" :options="CLASSES" /></template>
        </FormField>
        <FormField id="p1c-line1" label="Street address" :error="errors.address_line1">
          <template #default="f"><BaseInput v-bind="f" v-model="form.address_line1" /></template>
        </FormField>
        <FormField id="p1c-line2" label="Apartment, suite or unit (optional)" :error="errors.address_line2">
          <template #default="f"><BaseInput v-bind="f" v-model="form.address_line2" /></template>
        </FormField>
        <FormField id="p1c-city" label="City" :error="errors.city">
          <template #default="f"><BaseInput v-bind="f" v-model="form.city" /></template>
        </FormField>
        <div class="grid grid-cols-2 gap-3">
          <FormField id="p1c-state" label="State" :error="errors.state">
            <template #default="f"><ComboSelect v-bind="f" v-model="form.state" :options="US_STATES" /></template>
          </FormField>
          <FormField id="p1c-zip" label="ZIP code" :error="errors.postal_code">
            <template #default="f"><BaseInput v-bind="f" v-model="form.postal_code" inputmode="numeric" /></template>
          </FormField>
        </div>
      </div>

      <div class="space-y-3">
        <h4 class="text-xs font-semibold text-ink">Licences, the current CDL first</h4>
        <p v-if="errors.licences" class="text-sm text-danger-700">{{ errors.licences }}</p>
        <div
          v-for="(l, i) in form.licences"
          :key="i"
          class="space-y-3 rounded-surface bg-surface-muted p-3"
          :data-licence-row="i"
        >
          <p class="text-xs font-medium text-ink-tertiary">{{ i === 0 ? "Current CDL" : `Other licence ${i}` }}</p>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField :id="`p1c-l${i}-state`" label="State or province" :error="errors[`licences.${i}.state_code`]">
              <template #default="f"><ComboSelect v-bind="f" v-model="l.state_code" :options="JURISDICTIONS" /></template>
            </FormField>
            <FormField :id="`p1c-l${i}-number`" label="Licence number" :error="errors[`licences.${i}.licence_number`] ?? errors[`licences.${i}`]">
              <template #default="f"><BaseInput v-bind="f" v-model="l.licence_number" autocomplete="off" /></template>
            </FormField>
            <FormField :id="`p1c-l${i}-agency`" label="Issuing authority (only if not a US state)" :error="errors[`licences.${i}.agency`]">
              <template #default="f"><BaseInput v-bind="f" v-model="l.agency" /></template>
            </FormField>
            <FormField :id="`p1c-l${i}-expires`" label="Expiry date" :error="errors[`licences.${i}.expires_on`]">
              <template #default="f"><AppDateField v-bind="f" v-model="l.expires_on" /></template>
            </FormField>
          </div>
          <BaseButton v-if="i > 0" size="sm" variant="ghost" @click="form.licences.splice(i, 1)">Remove this licence</BaseButton>
        </div>
        <BaseButton size="sm" variant="secondary" @click="form.licences.push(blankLicence())">Add a licence</BaseButton>
      </div>

      <div class="flex justify-end gap-2">
        <BaseButton size="sm" variant="ghost" @click="editing = false">Cancel</BaseButton>
        <BaseButton size="sm" variant="primary" :disabled="correct.isPending.value" @click="save">Save the correction</BaseButton>
      </div>
    </div>
  </section>
</template>
