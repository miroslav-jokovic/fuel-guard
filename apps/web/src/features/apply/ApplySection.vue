<script setup lang="ts">
import type { ApplicationCaptureView, ApplicationSection, PartOneFactsView } from "@silvicom/shared";
import LicenceFields from "@/features/apply/LicenceFields.vue";
import DocumentCaptureFields from "@/features/apply/DocumentCaptureFields.vue";
import ReviewFields from "@/features/apply/ReviewFields.vue";
import EmployerCheckNotice from "@/features/apply/EmployerCheckNotice.vue";
import type { ApplicationDraft } from "@/features/apply/draft";
import type { SectionIssue } from "@/features/apply/useApplicationWizard";
import { useApplyScreen } from "@/features/apply/useScreenEvents";
import TaskWalk from "@/features/apply/wizard/TaskWalk.vue";
import { useTaskWalkContext } from "@/features/apply/wizard/useTaskWalk";

/**
 * One open task of the application, chosen by section — moved out of `ApplyPage.vue` on 2026-09-27
 * (C3c2a), when Part 2's task list needed room there.
 *
 * ── TWO KINDS OF TASK ─────────────────────────────────────────────────────────────────────────
 * Five are WALKED, one question to a screen, generated from the fact catalogue (`GENERATED_TASKS`:
 * About you, where you lived, where you worked, your driving record, the carrier's questions) — drawn
 * by `TaskWalk`. Three are drawn whole: "Your license" (Part 1's licences, shown), the documents, and
 * the review, which opens with the §391.21(d) notice (`EmployerCheckNotice`), the last screen before
 * anything is sent.
 *
 * ⚠ Each of the three is NAMED in the chain below; there is no bare `v-else`. Until 1b-5 (2026-11-15)
 * the five walked tasks each had a legacy wizard screen behind them here and the chain ended in a
 * `v-else` that was the review. With those screens deleted, a walked task that failed to open would
 * have fallen through to "Before you send". It draws nothing instead.
 */
const props = defineProps<{
  section: ApplicationSection;
  token: string;
  captures: ApplicationCaptureView[];
  /** The carrier's day, which the address and employment screens measure their three years from. */
  asOf: string;
  /** The same day, for the review's own check of the document (`ReviewFields`). */
  v2AsOf?: string | null;
  /**
   * Part 1's facts, once the unlock released them (C3c2c2, Q-AW34): "About you" and "Your license" show
   * them read-only, and the home lived in now is Part 1's.
   */
  partOne?: PartOneFactsView | null;
  identityLockedBy: string | null;
}>();
const draft = defineModel<ApplicationDraft>({ required: true });
const emit = defineEmits<{ goTo: [ApplicationSection]; show: [SectionIssue] }>();
// Part 2's screens, one per task (AW14).
useApplyScreen(() => `part2.${props.section}`);
/** F4 PR 1b: an open task the catalogue generates is walked one question to a screen (`useTaskWalk`). */
const walk = useTaskWalkContext();
</script>

<template>
  <TaskWalk v-if="walk && walk.active.value" v-model="draft" :walk="walk" :token="token" :part-one="partOne" :as-of="asOf" />
  <LicenceFields v-else-if="section === 'licence'" v-model="draft" :locked-by="identityLockedBy" :part-one="partOne" />
  <!-- A8: photographs, not answers. They are staged against the invitation rather than saved into
       the draft, which is why this screen takes the token and not the form. -->
  <DocumentCaptureFields v-else-if="section === 'documents'" :token="token" :captures="captures" />
  <div v-else-if="section === 'review'" class="space-y-6">
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
