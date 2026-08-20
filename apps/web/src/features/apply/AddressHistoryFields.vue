<script setup lang="ts">
import { AppButton as BaseButton, AppInput as BaseInput, AppFormField as FormField } from "@fuelguard/ui";
import { EMPLOYMENT_WINDOW_YEARS } from "@fuelguard/shared";
import { emptyAddress, type ApplicationDraft } from "@/features/apply/draft";

/** §391.21(b)(3) — every address for the three years preceding the application. */
const draft = defineModel<ApplicationDraft>({ required: true });
</script>

<template>
  <section class="space-y-4">
    <div>
      <h2 class="text-base font-semibold text-ink">Where you have lived</h2>
      <p class="mt-1 text-sm text-ink-muted">
        §391.21(b)(3) asks for every address you have lived at in the last
        {{ EMPLOYMENT_WINDOW_YEARS }} years. Leave the end month blank for where you live now.
      </p>
    </div>

    <div
      v-for="(address, i) in draft.addresses"
      :key="i"
      class="space-y-4 rounded-surface bg-surface-muted p-4"
    >
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField v-slot="{ id }" label="Street address">
          <BaseInput :id="id" v-model="address.line1" />
        </FormField>
        <FormField v-slot="{ id }" label="Apartment, unit" hint="Optional.">
          <BaseInput :id="id" v-model="address.line2" placeholder="Optional" />
        </FormField>
      </div>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <FormField v-slot="{ id }" label="City">
          <BaseInput :id="id" v-model="address.city" />
        </FormField>
        <FormField v-slot="{ id }" label="State">
          <BaseInput :id="id" v-model="address.state" maxlength="2" />
        </FormField>
        <FormField v-slot="{ id }" label="ZIP">
          <BaseInput :id="id" v-model="address.postal_code" />
        </FormField>
      </div>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField v-slot="{ id }" label="From" hint="Month and year, as 2024-03.">
          <BaseInput :id="id" v-model="address.from" placeholder="2024-03" />
        </FormField>
        <FormField v-slot="{ id }" label="Until" hint="Blank if you live here now.">
          <BaseInput :id="id" v-model="address.to" placeholder="2026-01" />
        </FormField>
      </div>
      <div v-if="draft.addresses.length > 1" class="flex justify-end">
        <BaseButton variant="ghost" size="sm" @click="draft.addresses.splice(i, 1)">Remove</BaseButton>
      </div>
    </div>

    <BaseButton @click="draft.addresses.push(emptyAddress())">Add another address</BaseButton>
  </section>
</template>
