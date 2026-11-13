<script setup lang="ts">
import { computed } from "vue";
import { isAsked, questionsForScreen, type ApplicationSection } from "@silvicom/shared";
import QuestionField from "@/features/apply/QuestionField.vue";
import { questionnaireAnswers } from "@/features/apply/questionnaireAnswers";
import type { ApplicationDraft } from "@/features/apply/draft";

/**
 * The carrier's own questions (A9, D-APP12).
 *
 * ── WHAT THIS SCREEN IS NOT ───────────────────────────────────────────────────────────────────
 * It is not part of §391.21. Every other screen in this wizard names the CFR paragraph it discharges;
 * this one deliberately names none, and says so to the driver in the first sentence — telling
 * somebody the regulation asks for their references when it does not is a small lie that a rendered
 * document then repeats.
 *
 * ── SEVEN OF THEM ARE REQUIRED NOW (§9 P8, Q-WF3) ────────────────────────────────────────────
 * Until P8 nothing on it blocked anything, and the audit measured what that bought: applications
 * arriving with every carrier question blank. The definition marks seven `required`; this screen marks
 * them, and the refusal is not this screen's — it is `APPLICATION_CROSS_FIELD_RULES`', in the schema the
 * API parses with, so the box marked here is exactly the box the server would refuse.
 *
 * Every other question has a `skip` ("I'd rather not say", "Doesn't apply") stored as an answer, so
 * the office can tell a question passed over on purpose from one never seen, and from a "no".
 *
 * The questions are DATA — a versioned definition in shared — so this file renders whatever the
 * definition holds and knows none of the carrier's questions by name. That is the whole of D-APP12
 * expressed as a component: the carrier's form changes without a line of this changing.
 */
const draft = defineModel<ApplicationDraft>({ required: true });

/**
 * Which screen's questions to render (D-AX7).
 *
 * ⚠ The component is unchanged in every other respect — it still knows none of the carrier's
 * questions by name and renders whatever the definition holds. What moved is that the definition now
 * says which screen each question belongs on, because the carrier's own paper says so: five of these
 * are on its page 1, beside the name and the address.
 */
const props = withDefaults(
  defineProps<{
    section?: ApplicationSection;
    /**
     * §15.3 D-CQ4: `carrier` draws the questions the CARRIER wrote, as stamped on this invitation, after the
     * built-in ones — the same fields, answered into `carrier_answers` and refused under that path. The
     * stamp is the carrier's own list, so it has no screens of its own and no intro: the page marks them
     * as neither the carrier's nor untranslated (D-CQ4).
     */
    source?: "builtin" | "carrier";
  }>(),
  { section: "questions", source: "builtin" },
);
// The rules for reading and writing an answer are the walk's too (`questionnaireAnswers`, F4 PR 1b-2).
// The definition is read once at setup: the screen chain is remounted on a language switch (`ApplyPage`).
const answers = questionnaireAnswers(() => draft.value, props.source);
const definition = answers.definition();
const carrier = props.source === "carrier";

/** This screen's questions that are asked, given the answers so far (`askedWhen`). */
const questions = computed(() =>
  questionsForScreen(definition, props.section).filter((q) => isAsked(q, answers.answers())),
);
</script>

<template>
  <div class="space-y-5">
    <!-- Only on the screen that IS the carrier's questions. On `identity` and `employment` these sit
         among the regulation's own fields and a paragraph explaining that they are not part of the
         federal application would be introducing a distinction the driver has no use for there. -->
    <p v-if="section === 'questions' && !carrier" class="text-sm text-ink-muted">{{ definition.intro }}</p>

    <!-- ⚠ A grid, and the reason is what these questions now sit beside (D-AX7). Rendered one per
         row, a two-word answer like "Position you are applying for" took a 680px input on a desktop
         while the name fields above it sat three to a row — the carrier's questions read as a
         different form bolted underneath the regulation's. A `longtext` or a `table` still spans the
         whole width, because those answers are paragraphs and grids and a half-width box invites a
         one-line answer to a question that wanted more. -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <QuestionField
        v-for="question in questions"
        :key="question.id"
        :question="question"
        :answers="answers"
        :class="(question.kind === 'longtext' || question.kind === 'table') && 'sm:col-span-2'"
      />
    </div>
  </div>
</template>
