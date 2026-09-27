<script setup lang="ts">
import type { ApplicationCaptureView, ApplicationSection } from "@silvicom/shared";
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

/**
 * One screen of the application, chosen by section — moved out of `ApplyPage.vue` whole on 2026-09-27
 * (C3c2a), at 421 of its 500 lines, when Part 2's task list needed room there. The branches are the
 * page's, unedited, except one addition: the review screen opens with the §391.21(d) notice
 * (`EmployerCheckNotice`), the last screen before anything is sent.
 */
defineProps<{
  section: ApplicationSection;
  token: string;
  captures: ApplicationCaptureView[];
  /** The carrier's day, which the address and employment screens measure their three years from. */
  asOf: string;
  /** That day on a v2 link, null on a legacy one — the employment screen's job panel asks more of v2 (C3c2b). */
  v2AsOf?: string | null;
  identityLockedBy: string | null;
}>();
const draft = defineModel<ApplicationDraft>({ required: true });
const emit = defineEmits<{ goTo: [ApplicationSection] }>();
</script>

<template>
  <ApplicantDetailsFields v-if="section === 'identity'" v-model="draft" :locked-by="identityLockedBy" />
  <AddressHistoryFields v-else-if="section === 'addresses'" v-model="draft" :as-of="asOf" />
  <LicenceFields v-else-if="section === 'licence'" v-model="draft" :locked-by="identityLockedBy" />
  <ApplyEmploymentFields v-else-if="section === 'employment'" v-model="draft" :as-of="asOf" :v2-as-of="v2AsOf" />
  <SafetyHistoryFields v-else-if="section === 'safety'" v-model="draft" />
  <!-- A9: the carrier's own questions, which discharge no CFR paragraph and block nothing. -->
  <QuestionnaireFields v-else-if="section === 'questions'" v-model="draft" />
  <!-- A8: photographs, not answers. They are staged against the invitation rather than saved into
       the draft, which is why this screen takes the token and not the form. -->
  <DocumentCaptureFields v-else-if="section === 'documents'" :token="token" :captures="captures" />
  <div v-else class="space-y-6">
    <EmployerCheckNotice />
    <ReviewFields :draft="draft" :captures="captures" @go-to="emit('goTo', $event)" />
  </div>
</template>
