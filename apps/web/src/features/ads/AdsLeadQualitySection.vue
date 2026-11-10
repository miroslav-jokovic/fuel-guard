<script setup lang="ts">
import { LEAD_QUALITY_WINDOW_DAYS } from "@silvicom/shared";
import { AppCard as BaseCard, AppFormField as FormField, AppInput as BaseInput, AppSwitch as BaseSwitch } from "@silvicom/ui";
import SettingsSection from "@/components/ui/SettingsSection.vue";

/**
 * Settings › Ads control's lead-quality alert (ADS-LEAD-QUALITY-PLAN LQ3b; Q-AD51 ruled (a)): when a campaign's
 * called leads are mostly wrong numbers, or its leads mostly miss a hard requirement, the people on the "Ad
 * leads that are unreachable or do not qualify" alert hear it. An alert, never a pause — said on the screen,
 * because a person reading "40 %" next to the pause rules would otherwise expect the ad to stop. Part of the
 * settings form, so it saves in the same version (adsSettingsForm.ts, "carried the same way").
 */
defineProps<{ editable: boolean; errorOn: (path: string) => string | undefined }>();
const enabled = defineModel<boolean>("enabled", { required: true });
const minAttempted = defineModel<string>("minAttempted", { required: true });
const wrongPct = defineModel<string>("wrongPct", { required: true });
const notQualifiedPct = defineModel<string>("notQualifiedPct", { required: true });
const SWITCH = "Tell us when a campaign's leads look wrong";
</script>

<template>
  <SettingsSection title="Lead quality" description="An alert, never a pause: the ad keeps running until a person decides.">
    <BaseCard as="div" class="space-y-4" data-test="lead-quality">
      <div class="flex items-center justify-between gap-4">
        <p class="text-sm text-ink">{{ SWITCH }}</p>
        <BaseSwitch v-model="enabled" :label="SWITCH" :disabled="!editable" data-test="lead-quality-switch" />
      </div>
      <div class="grid gap-4 sm:grid-cols-3">
        <FormField v-slot="{ id }" label="After this many leads" :error="errorOn('lead_quality.min_attempted')">
          <BaseInput :id="id" v-model="minAttempted" type="number" inputmode="numeric" step="1" min="1" :disabled="!editable" data-test="lead-quality-min" />
        </FormField>
        <FormField v-slot="{ id }" label="Wrong numbers, at least (%)" :error="errorOn('lead_quality.wrong_number_pct')">
          <BaseInput :id="id" v-model="wrongPct" type="number" inputmode="numeric" step="1" min="1" max="100" :disabled="!editable" data-test="lead-quality-wrong" />
        </FormField>
        <FormField v-slot="{ id }" label="Do not qualify, at least (%)" :error="errorOn('lead_quality.not_qualified_pct')">
          <BaseInput :id="id" v-model="notQualifiedPct" type="number" inputmode="numeric" step="1" min="1" max="100" :disabled="!editable" data-test="lead-quality-notq" />
        </FormField>
      </div>
      <div class="space-y-2 text-sm text-ink-muted" data-test="lead-quality-help">
        <p>Checked each morning over the last {{ LEAD_QUALITY_WINDOW_DAYS }} days of leads. Wrong numbers are counted among the leads someone has called, and wait for that many called leads. "Do not qualify" is counted among all the leads that arrived, and waits for that many leads, because those leads ring nobody and may never be called. It means the person's own answer plainly misses a hard requirement, such as no Class A. A requirement we could not ask about is never counted against them.</p>
        <p>Each campaign is alerted once per reason. The starting values, 40 % after 10 leads, are an industry rule of thumb, not our own numbers yet.</p>
      </div>
    </BaseCard>
  </SettingsSection>
</template>
