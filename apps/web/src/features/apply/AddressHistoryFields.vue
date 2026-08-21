<script setup lang="ts">
import { AppButton as BaseButton, AppInput as BaseInput, AppFormField as FormField } from "@fuelguard/ui";
import { emptyAddress, type ApplicationDraft } from "@/features/apply/draft";
import { APPLY_COPY } from "@/features/apply/strings";

/** §391.21(b)(3) — every address for the three years preceding the application. */
const draft = defineModel<ApplicationDraft>({ required: true });
const copy = APPLY_COPY.addresses;
</script>

<template>
  <section class="space-y-4">
    <p class="text-sm text-ink-muted">{{ copy.intro }}</p>

    <div
      v-for="(address, i) in draft.addresses"
      :key="i"
      class="space-y-4 rounded-surface bg-surface-muted p-4"
    >
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField v-slot="{ id }" :label="copy.line1">
          <BaseInput :id="id" v-model="address.line1" />
        </FormField>
        <FormField v-slot="{ id }" :label="copy.line2" :hint="copy.optional">
          <BaseInput :id="id" v-model="address.line2" placeholder="Optional" />
        </FormField>
      </div>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <FormField v-slot="{ id }" :label="copy.city">
          <BaseInput :id="id" v-model="address.city" />
        </FormField>
        <FormField v-slot="{ id }" :label="copy.state">
          <BaseInput :id="id" v-model="address.state" maxlength="2" />
        </FormField>
        <FormField v-slot="{ id }" :label="copy.postal_code">
          <BaseInput :id="id" v-model="address.postal_code" />
        </FormField>
      </div>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField v-slot="{ id }" :label="copy.from" :hint="copy.fromHint">
          <BaseInput :id="id" v-model="address.from" placeholder="2024-03" />
        </FormField>
        <FormField v-slot="{ id }" :label="copy.to" :hint="copy.toHint">
          <BaseInput :id="id" v-model="address.to" placeholder="2026-01" />
        </FormField>
      </div>
      <div v-if="draft.addresses.length > 1" class="flex justify-end">
        <BaseButton variant="ghost" size="sm" @click="draft.addresses.splice(i, 1)">{{ copy.remove }}</BaseButton>
      </div>
    </div>

    <BaseButton @click="draft.addresses.push(emptyAddress())">{{ copy.add }}</BaseButton>
  </section>
</template>
