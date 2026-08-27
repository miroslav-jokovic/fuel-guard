<script setup lang="ts">
import { AppButton as BaseButton, AppInput as BaseInput, AppDateField, AppFormField as FormField } from "@silvicom/ui";
import { emptyLicence, type ApplicationDraft } from "@/features/apply/draft";
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
</script>

<template>
  <section class="space-y-4">
    <p class="text-sm text-ink-muted">{{ copy.intro }}</p>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-4">
      <FormField v-slot="{ id }" :label="copy.number">
        <BaseInput :id="id" v-model="draft.cdl_number" />
      </FormField>
      <FormField v-slot="{ id }" :label="copy.state" :hint="copy.stateHint">
        <BaseInput :id="id" v-model="draft.cdl_state" maxlength="2" />
      </FormField>
      <FormField v-slot="{ id }" :label="copy.class" :hint="copy.optional">
        <BaseInput :id="id" v-model="draft.cdl_class" maxlength="10" />
      </FormField>
      <FormField v-slot="{ id }" :label="copy.expires">
        <AppDateField :id="id" v-model="draft.cdl_expires_at" />
      </FormField>
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
          <FormField v-slot="{ id }" :label="copy.issuingAuthority" :hint="copy.issuingAuthorityHint">
            <BaseInput :id="id" v-model="licence.issuing_authority" />
          </FormField>
          <FormField v-slot="{ id }" :label="copy.otherNumber">
            <BaseInput :id="id" v-model="licence.number" />
          </FormField>
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField v-slot="{ id }" :label="copy.expires">
            <AppDateField :id="id" v-model="licence.expires_at" />
          </FormField>
          <FormField v-slot="{ id }" :label="copy.otherKind" :hint="copy.otherKindHint">
            <BaseInput :id="id" v-model="licence.kind" placeholder="Optional" />
          </FormField>
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
