<script setup lang="ts">
import { LEAD_OUTCOME_STAGES, UNRECORDED_LEAD_STAGES, type LeadOutcomeStage, type UnrecordedLeadStage } from "@silvicom/shared";
import { AppCard as BaseCard, AppFormField as FormField, AppInput as BaseInput, AppSwitch as BaseSwitch } from "@silvicom/ui";
import SettingsSection from "@/components/ui/SettingsSection.vue";

/**
 * Settings › Ads control's outcome feed (Q-AD40; B6, D-AD14): whether Silvicom tells Meta how far each ad lead
 * got, and into which Events Manager dataset. Part of the settings form, so it saves in the same version
 * (adsSettingsForm.ts, "one save, one version" and "the outcome feed is carried").
 *
 * The stages are the shared lists, worded here: `LEAD_OUTCOME_STAGES` are what is recorded and so what is sent,
 * under their own names (`outcomeEvents.ts`: `event_name` is the stage as it stands); `UNRECORDED_LEAD_STAGES`
 * have no writer anywhere, so they are never sent, not even as a zero (Q-AD37). tsc holds each word map to its
 * list both ways, so a stage that moves from one list to the other cannot be described on the wrong side.
 */
defineProps<{ editable: boolean; error?: string }>();
const enabled = defineModel<boolean>("enabled", { required: true });
const datasetId = defineModel<string>("datasetId", { required: true });

const SENT: Record<LeadOutcomeStage, string> = {
  contacted: "Contacted",
  qualified: "Qualified by a recruiter",
  not_qualified: "Closed as not qualified",
  converted: "Made an applicant",
  applied: "Applied",
  hired: "Hired",
  lost_before_conversion: "Closed before becoming an applicant",
  lost_after_conversion: "Did not work out after applying",
};
// Empty since 0578 (LQ5): every stage a recruiter names has a writer. Kept so a future unrecorded stage is
// named here rather than silently absent (the type makes a missing label a compile error).
const NOT_SENT: Record<UnrecordedLeadStage, string> = {};
const sent = LEAD_OUTCOME_STAGES.map((s) => SENT[s]).join(", ");
const notSent = (UNRECORDED_LEAD_STAGES as readonly UnrecordedLeadStage[]).map((s) => NOT_SENT[s]).join(" and ");
const SWITCH = "Tell Meta how far each lead got";
</script>

<template>
  <SettingsSection title="Outcome feed" description="So Meta can find more people like the ones you hire. Off until you turn it on.">
    <BaseCard as="div" class="space-y-4" data-test="outcome-feed">
      <div class="flex items-center justify-between gap-4">
        <p class="text-sm text-ink">{{ SWITCH }}</p>
        <BaseSwitch v-model="enabled" :label="SWITCH" :disabled="!editable" data-test="outcome-feed-switch" />
      </div>
      <FormField v-slot="{ id }" label="Meta dataset id" hint="The digits of the dataset in Meta's Events Manager. Needed before the feed can be turned on." :error="error">
        <BaseInput :id="id" v-model="datasetId" inputmode="numeric" autocomplete="off" class="sm:max-w-xs" :disabled="!editable" data-test="outcome-dataset" />
      </FormField>
      <div class="space-y-2 text-sm text-ink-muted" data-test="outcome-feed-help">
        <p>
          Once a day, for each lead that came from a Meta ad, Silvicom sends the stages that lead reached, under their own names:
          {{ sent }}.
        </p>
        <p v-if="notSent">{{ notSent }} are not recorded anywhere yet, so they are never sent, not even as a zero.</p>
        <p v-else>A stage is sent only when a recruiter's act or a record on file reached it — nothing is sent as a zero.</p>
        <p>Each stage goes with Meta's own id for the lead and nothing else: no name, phone or email. Meta takes stages up to 7 days old; an older one is skipped.</p>
      </div>
    </BaseCard>
  </SettingsSection>
</template>
