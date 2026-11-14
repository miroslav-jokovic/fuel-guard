<script setup lang="ts">
import type { ApplicationCaptureView, ApplicationSection, PartOneFactsView } from "@silvicom/shared";
import ApplicantDetailsFields from "@/features/apply/ApplicantDetailsFields.vue";
import AddressHistoryFields from "@/features/apply/AddressHistoryFields.vue";
import LicenceFields from "@/features/apply/LicenceFields.vue";
import ApplyEmploymentFields from "@/features/apply/ApplyEmploymentFields.vue";
import SafetyHistoryFields from "@/features/apply/SafetyHistoryFields.vue";
import QuestionnaireFields from "@/features/apply/QuestionnaireFields.vue";
import DocumentCaptureFields from "@/features/apply/DocumentCaptureFields.vue";
import ReviewFields from "@/features/apply/ReviewFields.vue";
import EmployerCheckNotice from "@/features/apply/EmployerCheckNotice.vue";
import type { ApplicationDraft } from "@/features/apply/draft";
import type { SectionIssue } from "@/features/apply/useApplicationWizard";
import { useApplyScreen } from "@/features/apply/useScreenEvents";
import { servedCarrierQuestions } from "@/features/apply/servedForm";
import TaskWalk from "@/features/apply/wizard/TaskWalk.vue";
import { useTaskWalkContext } from "@/features/apply/wizard/useTaskWalk";

/**
 * One screen of the application, chosen by section — moved out of `ApplyPage.vue` whole on 2026-09-27
 * (C3c2a), at 421 of its 500 lines, when Part 2's task list needed room there. The branches are the
 * page's, unedited, except one addition: the review screen opens with the §391.21(d) notice
 * (`EmployerCheckNotice`), the last screen before anything is sent.
 */
const props = defineProps<{
  section: ApplicationSection;
  token: string;
  captures: ApplicationCaptureView[];
  /** The carrier's day, which the address and employment screens measure their three years from. */
  asOf: string;
  /** That day on a v2 link, null on a legacy one — v2's job panel asks more (C3c2b), its addresses loop (C3c2c1). */
  v2AsOf?: string | null;
  /**
   * A v2 link's Part 1 facts, once the unlock released them (C3c2c2, Q-AW34): "About you" and "Your
   * licences" show them read-only, the current address is Part 1's, and §40.25(j) is not asked again.
   */
  partOne?: PartOneFactsView | null;
  identityLockedBy: string | null;
}>();
const draft = defineModel<ApplicationDraft>({ required: true });
const emit = defineEmits<{ goTo: [ApplicationSection]; show: [SectionIssue] }>();
// Part 2's screens, one per section, in both the task list and the legacy wizard (AW14).
useApplyScreen(() => `part2.${props.section}`);
/** F4 PR 1b: an open task the catalogue generates is walked one question to a screen (`useTaskWalk`). */
const walk = useTaskWalkContext();
</script>

<template>
  <TaskWalk v-if="walk && walk.active.value" v-model="draft" :walk="walk" :token="token" :part-one="partOne" />
  <ApplicantDetailsFields v-else-if="section === 'identity'" v-model="draft" :locked-by="identityLockedBy" :part-one="partOne" :token="token" />
  <AddressHistoryFields v-else-if="section === 'addresses'" v-model="draft" :as-of="asOf" :v2-as-of="v2AsOf" :part-one="partOne" />
  <LicenceFields v-else-if="section === 'licence'" v-model="draft" :locked-by="identityLockedBy" :part-one="partOne" />
  <ApplyEmploymentFields v-else-if="section === 'employment'" v-model="draft" :as-of="asOf" :v2-as-of="v2AsOf" />
  <SafetyHistoryFields v-else-if="section === 'safety'" v-model="draft" :ask-prior-test="!partOne" />
  <!-- A9: the carrier's own questions, which discharge no CFR paragraph. §15.3 D-CQ4: then the ones the
       carrier wrote itself, as stamped on this invitation — the same fields, after the built-in ones. -->
  <div v-else-if="section === 'questions'" class="space-y-5">
    <QuestionnaireFields v-model="draft" />
    <QuestionnaireFields v-if="servedCarrierQuestions.length > 0" v-model="draft" source="carrier" />
  </div>
  <!-- A8: photographs, not answers. They are staged against the invitation rather than saved into
       the draft, which is why this screen takes the token and not the form. -->
  <DocumentCaptureFields v-else-if="section === 'documents'" :token="token" :captures="captures" />
  <div v-else class="space-y-6">
    <EmployerCheckNotice />
    <ReviewFields
      :draft="draft"
      :captures="captures"
      :v2-as-of="v2AsOf"
      @go-to="emit('goTo', $event)"
      @show="emit('show', $event)"
    />
  </div>
</template>
