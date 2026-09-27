<script setup lang="ts">
import { computed, toRef } from "vue";
import { AppButton as BaseButton, AppCallout } from "@silvicom/ui";
import PartOneAnswerFields from "./PartOneAnswerFields.vue";
import PartOneOtherLicences from "./PartOneOtherLicences.vue";
import PartOnePhoto from "./PartOnePhoto.vue";
import PartOneRights from "./PartOneRights.vue";
import { isPhotoScreen, type PartOneScreen } from "./partOneScreens";
import { usePartOne, type PartOneInputs } from "./usePartOne";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * Part 1 — "Get started" — as a linear stepper (APPLICATION-FLOW-V2-PLAN.md §6.2, D-AW11, AW3, C3a).
 *
 * ── WHERE IT SITS ─────────────────────────────────────────────────────────────────────────────
 * After the welcome (screen 1, `ApplyExpectations`) and the 7001(c) consent (screen 2), which exist and
 * are unchanged; before the six permissions (screens 14–19, the existing ceremony), which the server
 * refuses on a v2 link until Part 1 is finished (`intake_incomplete`). So this walks screens 3–10 and
 * 12, and its last Continue is `complete_applicant_intake`: the stamp, and the photographs filed.
 * Screen 11 (the selfie) waits for Q-AW5 (AW6); screen 13 (adopt a signature) is C3s's (D-AW15).
 *
 * ── LINEAR, ONE THING PER SCREEN ──────────────────────────────────────────────────────────────
 * A stepper, not the task list Part 2 gets (D-AW11): Part 1 is nine minutes, its order is the order the
 * office needs the facts in, and a driver on a phone is served by "Step 4 of 9" and one Continue. Back
 * is always there; a returning applicant opens on the first screen still owed (`resumeScreen`).
 *
 * ⚠ The photo screen is keyed by screen: `useApplicationCaptures` reads its slot list once, at setup, so
 * a reused instance would keep photographing the CDL's front on the medical-card screen.
 */
const props = defineProps<{
  token: string;
  carrier: string;
  inputs: PartOneInputs;
  refresh: () => Promise<PartOneInputs | null>;
}>();
const emit = defineEmits<{ done: [] }>();

const copy = APPLY_COPY.partOne;
const flow = usePartOne(toRef(props, "token"), toRef(props, "inputs"), props.refresh, () => emit("done"));
const answers = flow.answers;

const HEADINGS: Record<Exclude<PartOneScreen, "cdl_front" | "cdl_back" | "medical_card">, string> = {
  about: copy.about.heading,
  address: copy.address.heading,
  licence: copy.licence.heading,
  otherLicences: copy.otherLicences.heading,
  screening: copy.screening.heading,
  rights: copy.rights.heading,
};
const heading = computed(() => {
  const s = flow.screen.value;
  return isPhotoScreen(s) ? copy.photo[s].heading : HEADINGS[s];
});
const intro = computed(() => {
  switch (flow.screen.value) {
    case "about": return copy.about.intro(props.carrier);
    case "address": return copy.address.intro;
    case "licence": return copy.licence.intro;
    case "screening": return copy.screening.intro;
    case "rights": return copy.rights.intro(props.carrier);
    default: return null;
  }
});
const action = computed(() => (flow.screen.value === "rights" ? copy.rights.acknowledge : copy.next));
</script>

<template>
  <section class="space-y-5">
    <div>
      <p class="text-xs font-medium text-ink-tertiary">{{ copy.step(flow.step.value, flow.steps) }}</p>
      <h1 class="mt-1 text-lg font-semibold text-ink">{{ heading }}</h1>
      <p v-if="intro" class="mt-2 text-sm text-ink-muted">{{ intro }}</p>
    </div>

    <!-- Answers on file that this page cannot re-post whole (the licence list, see `usePartOne`). -->
    <AppCallout v-if="flow.locked.value" tone="info">{{ APPLY_COPY.identityStep.lockedHint(carrier) }}</AppCallout>
    <template v-else>
      <AppCallout v-if="flow.onFile.value" tone="info">{{ copy.onFile }}</AppCallout>
      <PartOneOtherLicences
        v-if="flow.screen.value === 'otherLicences'"
        v-model:answers="answers"
        :errors="flow.errors.value"
      />
      <PartOnePhoto
        v-else-if="isPhotoScreen(flow.screen.value)"
        :key="flow.screen.value"
        v-model:answers="answers"
        :token="token"
        :photo="flow.screen.value"
        :captures="[...inputs.captures]"
        :errors="flow.errors.value"
      />
      <PartOneRights v-else-if="flow.screen.value === 'rights' && inputs.summary" :summary="inputs.summary" />
      <PartOneAnswerFields v-else v-model:answers="answers" :screen="flow.screen.value" :errors="flow.errors.value" />
    </template>

    <AppCallout v-if="flow.kept.value" tone="info">{{ copy.kept(carrier) }}</AppCallout>
    <p v-if="flow.failure.value" class="text-sm text-danger-700" role="alert">{{ flow.failure.value }}</p>

    <div class="flex items-center justify-between gap-3">
      <BaseButton v-if="flow.step.value > 1" variant="ghost" :disabled="flow.working.value" @click="flow.back()">
        {{ copy.back }}
      </BaseButton>
      <span v-else />
      <BaseButton
        variant="primary"
        :disabled="flow.working.value"
        @click="flow.kept.value ? flow.acknowledgeKept() : flow.next()"
      >
        {{ flow.working.value ? copy.working : action }}
      </BaseButton>
    </div>
  </section>
</template>
