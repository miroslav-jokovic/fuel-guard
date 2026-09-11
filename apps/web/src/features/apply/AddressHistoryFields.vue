<script setup lang="ts">
import {
  AppButton as BaseButton,
  AppCombobox as ComboSelect,
  AppInput as BaseInput,
  AppMonthField,
} from "@silvicom/ui";
import { jurisdictionOptions } from "@silvicom/shared";
import { emptyAddress, type ApplicationDraft } from "@/features/apply/draft";
import ApplyField from "@/features/apply/ApplyField.vue";
import { APPLY_COPY } from "@/features/apply/strings";

/** §391.21(b)(3) — every address for the three years preceding the application. */
const draft = defineModel<ApplicationDraft>({ required: true });
const copy = APPLY_COPY.addresses;

/** One catalogue, three fields (D-AX5). Computed once here rather than per address row. */
const JURISDICTIONS = jurisdictionOptions();
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
        <ApplyField v-slot="f" :path="['addresses', i, 'line1']" :label="copy.line1">
          <BaseInput v-bind="f" v-model="address.line1" />
        </ApplyField>
        <ApplyField v-slot="f" :path="['addresses', i, 'line2']" :label="copy.line2" :hint="copy.optional">
          <BaseInput v-bind="f" v-model="address.line2" placeholder="Optional" />
        </ApplyField>
      </div>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <ApplyField v-slot="f" :path="['addresses', i, 'city']" :label="copy.city">
          <BaseInput v-bind="f" v-model="address.city" />
        </ApplyField>
        <ApplyField v-slot="f" :path="['addresses', i, 'state']" :label="copy.state">
          <ComboSelect v-bind="f" v-model="address.state" :options="JURISDICTIONS" />
        </ApplyField>
        <ApplyField v-slot="f" :path="['addresses', i, 'postal_code']" :label="copy.postal_code">
          <BaseInput v-bind="f" v-model="address.postal_code" />
        </ApplyField>
      </div>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ApplyField v-slot="f" :path="['addresses', i, 'from']" :label="copy.from" :hint="copy.fromHint">
          <AppMonthField v-bind="f" v-model="address.from" />
        </ApplyField>
        <ApplyField v-slot="f" :path="['addresses', i, 'to']" :label="copy.to" :hint="copy.toHint">
          <AppMonthField v-bind="f" v-model="address.to" />
        </ApplyField>
      </div>
      <div v-if="draft.addresses.length > 1" class="flex justify-end">
        <BaseButton variant="ghost" size="sm" @click="draft.addresses.splice(i, 1)">{{ copy.remove }}</BaseButton>
      </div>
    </div>

    <BaseButton @click="draft.addresses.push(emptyAddress())">{{ copy.add }}</BaseButton>
  </section>
</template>
