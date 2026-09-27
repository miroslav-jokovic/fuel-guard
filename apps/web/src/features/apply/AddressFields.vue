<script setup lang="ts">
import { AppCombobox as ComboSelect, AppInput as BaseInput, AppMonthField } from "@silvicom/ui";
import { jurisdictionOptions } from "@silvicom/shared";
import ApplyField from "@/features/apply/ApplyField.vue";
import type { DraftAddress } from "@/features/apply/draft";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * One address's boxes — §391.21(b)(3), one row of it.
 *
 * Its own component since C3c2c1, because it is shown in two places: inline on a legacy link's address
 * screen, as it always was, and in the one-address panel (`AddressDrawer`) on a v2 link. One block of
 * fields, placed twice, rather than two copies that could drift on the next field.
 */
defineProps<{ index: number }>();
const address = defineModel<DraftAddress>({ required: true });
const copy = APPLY_COPY.addresses;
/** One catalogue, three fields (D-AX5). */
const JURISDICTIONS = jurisdictionOptions();
</script>

<template>
  <div class="space-y-4">
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <ApplyField v-slot="f" :path="['addresses', index, 'line1']" :label="copy.line1">
        <BaseInput v-bind="f" v-model="address.line1" autocomplete="address-line1" />
      </ApplyField>
      <ApplyField v-slot="f" :path="['addresses', index, 'line2']" :label="copy.line2" :hint="copy.optional">
        <BaseInput v-bind="f" v-model="address.line2" placeholder="Optional" autocomplete="address-line2" />
      </ApplyField>
    </div>
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <ApplyField v-slot="f" :path="['addresses', index, 'city']" :label="copy.city">
        <BaseInput v-bind="f" v-model="address.city" autocomplete="address-level2" />
      </ApplyField>
      <ApplyField v-slot="f" :path="['addresses', index, 'state']" :label="copy.state">
        <ComboSelect v-bind="f" v-model="address.state" :options="JURISDICTIONS" />
      </ApplyField>
      <ApplyField v-slot="f" :path="['addresses', index, 'postal_code']" :label="copy.postal_code">
        <BaseInput v-bind="f" v-model="address.postal_code" inputmode="numeric" autocomplete="postal-code" />
      </ApplyField>
    </div>
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <ApplyField v-slot="f" :path="['addresses', index, 'from']" :label="copy.from" :hint="copy.fromHint">
        <AppMonthField v-bind="f" v-model="address.from" />
      </ApplyField>
      <ApplyField v-slot="f" :path="['addresses', index, 'to']" :label="copy.to" :hint="copy.toHint">
        <AppMonthField v-bind="f" v-model="address.to" />
      </ApplyField>
    </div>
  </div>
</template>
