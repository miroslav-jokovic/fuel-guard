<script setup lang="ts">
import { AppCheckbox as BaseCheckbox } from "@silvicom/ui";
import YesNoField from "@/features/apply/YesNoField.vue";
import { useApplyIssues } from "@/features/apply/issues";
import type { DraftEmployer } from "@/features/apply/draft";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * What the job was: §391.21(b)(10)(iv)'s two "whether" questions, then whether the driver drove a
 * commercial vehicle in it — §6.4's order (C3c2b).
 *
 * ── WHY TWO YES/NO QUESTIONS WITH NOTHING CHOSEN (Q-AW33) ─────────────────────────────────────
 * They were two unticked checkboxes over a draft that started `false`, so every job was filed with
 * "No" to both whether or not the driver had read them — and a v2 filing's rule that refuses a blank
 * could never fire, because the page never sent one. Now the draft holds `null` until a choice is
 * made (`emptyEmployer`), and that rule does its job.
 *
 * ── WHY `askWhether` ──────────────────────────────────────────────────────────────────────────
 * (iv) belongs to (b)(10) — the jobs in the last three years. On a v2 link the panel asks it only of
 * a job whose dates put it there (`employmentSegments`, the filing's own test), so a driving job from
 * year six is not asked a question the regulation does not ask about it. A legacy link asks it of
 * every job, as its checkboxes did.
 *
 * `operated_cmv` stays a pre-ticked box: its default is argued in `draftShape.ts` (an unticked
 * driving job silently drops a §391.23 inquiry) and is not what Q-AW33 is about.
 */
defineProps<{ index: number; askWhether: boolean }>();
const local = defineModel<DraftEmployer>({ required: true });
const copy = APPLY_COPY.employment;
// The panel's own issues (`EmployerDrawer` provides them), so a refusal lands under its question.
const { errorFor, idFor } = useApplyIssues();
</script>

<template>
  <div class="space-y-4">
    <template v-if="askWhether">
      <YesNoField
        :id="idFor(['employers', index, 'subject_to_fmcsr'])"
        v-model="local.subject_to_fmcsr"
        :legend="copy.subjectToFmcsr"
        :hint="copy.subjectToFmcsrHint"
        :error="errorFor(['employers', index, 'subject_to_fmcsr'])"
      />
      <YesNoField
        :id="idFor(['employers', index, 'safety_sensitive'])"
        v-model="local.safety_sensitive"
        :legend="copy.safetySensitive"
        :hint="copy.safetySensitiveHint"
        :error="errorFor(['employers', index, 'safety_sensitive'])"
      />
    </template>
    <BaseCheckbox v-model="local.operated_cmv" size="touch">{{ copy.operatedCmv }}</BaseCheckbox>
  </div>
</template>
