<script setup lang="ts">
import { AppCombobox as ComboSelect, AppInput as BaseInput } from "@silvicom/ui";
import { jurisdictionOptions } from "@silvicom/shared";
import ApplyField from "@/features/apply/ApplyField.vue";
import type { DraftEmployer } from "@/features/apply/draft";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * Where a job was and why it ended — §391.21(b)(10)(i)'s address and (iii)'s reason for leaving.
 *
 * Its own component since C3c2b because it sits in one of two places in `EmployerDrawer`: on a v2 link
 * a filing refuses a job without them (AW1), so they are asked in the panel's main run, in §6.4's order;
 * on a legacy link nothing asks for them (the owner, 2026-09-11: "all other things are optional"), so
 * they stay behind the "(optional)" disclosure. One block of fields, placed twice, rather than two
 * copies that could drift on the next field.
 */
defineProps<{ index: number }>();
const local = defineModel<DraftEmployer>({ required: true });
const copy = APPLY_COPY.employment;
const JURISDICTIONS = jurisdictionOptions();
</script>

<template>
  <div class="space-y-4">
    <ApplyField
      v-slot="f"
      :path="['employers', index, 'address_line1']"
      :label="copy.address"
      :hint="copy.addressHint"
    >
      <BaseInput v-bind="f" v-model="local.address_line1" />
    </ApplyField>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <ApplyField v-slot="f" :path="['employers', index, 'city']" :label="copy.city">
        <BaseInput v-bind="f" v-model="local.city" />
      </ApplyField>
      <ApplyField v-slot="f" :path="['employers', index, 'state']" :label="copy.state">
        <ComboSelect v-bind="f" v-model="local.state" :options="JURISDICTIONS" />
      </ApplyField>
    </div>

    <ApplyField
      v-slot="f"
      :path="['employers', index, 'reason_for_leaving']"
      :label="copy.reason"
      :hint="copy.reasonHint"
    >
      <BaseInput v-bind="f" v-model="local.reason_for_leaving" />
    </ApplyField>
  </div>
</template>
