<script setup lang="ts">
import {
  AppButton as BaseButton,
  AppCombobox as ComboSelect,
  AppInput as BaseInput,
  AppDateField,
} from "@silvicom/ui";
import { jurisdictionOptions } from "@silvicom/shared";
import { emptyLicence, type ApplicationDraft } from "@/features/apply/draft";
import ApplyField from "@/features/apply/ApplyField.vue";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * §391.21(b)(5) — "each unexpired commercial motor vehicle operator's license or permit".
 *
 * Read verbatim 2026-08-21: the regulation asks for a LIST, and this form asked for one licence
 * until A3. The primary licence stays first and separate because it is the one that fills in
 * `drivers.cdl_number`, the one a PSP report is matched against and the one an MVR is ordered on;
 * everything else goes in the list below it.
 *
 * The copy says most drivers will add nothing, because §383.21 forbids holding more than one
 * commercial licence at a time — so an empty list is the expected answer and the form should not
 * imply the driver has forgotten something.
 */
const draft = defineModel<ApplicationDraft>({ required: true });
const copy = APPLY_COPY.licence;

/**
 * The issuing state, from the one catalogue (D-AX5).
 *
 * ⚠ This is the field with the most to lose from a typo. `cdl_state` is what a PSP request and an
 * MVR pull are keyed on, so `Il` instead of `IL` is not a cosmetic defect — it is a screening
 * request that comes back empty for a driver who is perfectly qualified, and nothing in the result
 * says why.
 */
const JURISDICTIONS = jurisdictionOptions();
</script>

<template>
  <section class="space-y-4">
    <p class="text-sm text-ink-muted">{{ copy.intro }}</p>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-4">
      <ApplyField v-slot="f" :path="['cdl_number']" :label="copy.number">
        <BaseInput v-bind="f" v-model="draft.cdl_number" />
      </ApplyField>
      <ApplyField v-slot="f" :path="['cdl_state']" :label="copy.state" :hint="copy.stateHint">
        <ComboSelect v-bind="f" v-model="draft.cdl_state" :options="JURISDICTIONS" />
      </ApplyField>
      <ApplyField v-slot="f" :path="['cdl_class']" :label="copy.class" :hint="copy.optional">
        <BaseInput v-bind="f" v-model="draft.cdl_class" maxlength="10" />
      </ApplyField>
      <ApplyField v-slot="f" :path="['cdl_expires_at']" :label="copy.expires">
        <AppDateField v-bind="f" v-model="draft.cdl_expires_at" />
      </ApplyField>
    </div>

    <div class="space-y-3">
      <h3 class="text-sm font-semibold text-ink">{{ copy.othersHeading }}</h3>
      <p class="text-sm text-ink-muted">{{ copy.othersIntro }}</p>

      <div
        v-for="(licence, i) in draft.additional_licences"
        :key="i"
        class="space-y-4 rounded-surface bg-surface-muted p-4"
      >
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ApplyField v-slot="f" :path="['additional_licences', i, 'issuing_authority']" :label="copy.issuingAuthority" :hint="copy.issuingAuthorityHint">
            <BaseInput v-bind="f" v-model="licence.issuing_authority" />
          </ApplyField>
          <ApplyField v-slot="f" :path="['additional_licences', i, 'number']" :label="copy.otherNumber">
            <BaseInput v-bind="f" v-model="licence.number" />
          </ApplyField>
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ApplyField v-slot="f" :path="['additional_licences', i, 'expires_at']" :label="copy.expires">
            <AppDateField v-bind="f" v-model="licence.expires_at" />
          </ApplyField>
          <ApplyField v-slot="f" :path="['additional_licences', i, 'kind']" :label="copy.otherKind" :hint="copy.otherKindHint">
            <BaseInput v-bind="f" v-model="licence.kind" placeholder="Optional" />
          </ApplyField>
        </div>
        <div class="flex justify-end">
          <BaseButton variant="ghost" size="sm" @click="draft.additional_licences.splice(i, 1)">
            {{ copy.remove }}
          </BaseButton>
        </div>
      </div>

      <BaseButton @click="draft.additional_licences.push(emptyLicence())">{{ copy.addOther }}</BaseButton>
    </div>
  </section>
</template>
