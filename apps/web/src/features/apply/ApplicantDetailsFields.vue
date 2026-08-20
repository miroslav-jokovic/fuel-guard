<script setup lang="ts">
import { AppInput as BaseInput, AppDateField, AppFormField as FormField } from "@fuelguard/ui";
import type { ApplicationDraft } from "@/features/apply/draft";

/** §391.21(b)(2) identity and (b)(5) licence — the fields a PSP or MVR request is matched on. */
const draft = defineModel<ApplicationDraft>({ required: true });
</script>

<template>
  <section class="space-y-4">
    <div>
      <h2 class="text-base font-semibold text-ink">About you</h2>
      <p class="mt-1 text-sm text-ink-muted">
        Your name and date of birth are matched against your driving record, so enter them exactly as
        they appear on your licence.
      </p>
    </div>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <FormField v-slot="{ id }" label="First name">
        <BaseInput :id="id" v-model="draft.first_name" autocomplete="given-name" />
      </FormField>
      <FormField v-slot="{ id }" label="Middle name" hint="Optional.">
        <BaseInput :id="id" v-model="draft.middle_name" autocomplete="additional-name" />
      </FormField>
      <FormField v-slot="{ id }" label="Last name">
        <BaseInput :id="id" v-model="draft.last_name" autocomplete="family-name" />
      </FormField>
    </div>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <FormField v-slot="{ id }" label="Date of birth">
        <AppDateField :id="id" v-model="draft.date_of_birth" />
      </FormField>
      <FormField v-slot="{ id }" label="Email">
        <BaseInput :id="id" v-model="draft.email" type="email" autocomplete="email" />
      </FormField>
      <FormField v-slot="{ id }" label="Phone">
        <BaseInput :id="id" v-model="draft.phone" type="tel" autocomplete="tel" />
      </FormField>
    </div>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-4">
      <FormField v-slot="{ id }" label="Licence number">
        <BaseInput :id="id" v-model="draft.cdl_number" />
      </FormField>
      <FormField v-slot="{ id }" label="Issuing state" hint="Two letters.">
        <BaseInput :id="id" v-model="draft.cdl_state" maxlength="2" />
      </FormField>
      <FormField v-slot="{ id }" label="Class" hint="Optional.">
        <BaseInput :id="id" v-model="draft.cdl_class" maxlength="10" />
      </FormField>
      <FormField v-slot="{ id }" label="Expires">
        <AppDateField :id="id" v-model="draft.cdl_expires_at" />
      </FormField>
    </div>

    <FormField v-slot="{ id }" label="Driving experience" hint="Optional — equipment, routes, years.">
      <BaseInput :id="id" v-model="draft.experience" placeholder="Optional" />
    </FormField>
  </section>
</template>
