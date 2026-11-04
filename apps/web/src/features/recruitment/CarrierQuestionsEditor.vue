<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import {
  CARRIER_QUESTIONS_LIVE_MAX,
  CARRIER_QUESTION_KINDS,
  CARRIER_QUESTION_KIND_LABELS,
  carrierQuestionCreateSchema,
  carrierQuestionUpdateSchema,
  type CarrierQuestion,
  type CarrierQuestionKind,
} from "@silvicom/shared";
import {
  AppButton as BaseButton,
  AppCheckbox,
  AppFormField as FormField,
  AppInput as BaseInput,
  AppSelect,
  AppTextarea,
  QueryState,
  useConfirm,
} from "@silvicom/ui";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import {
  useAddCarrierQuestion,
  useCarrierQuestions,
  useUpdateCarrierQuestion,
} from "@/features/recruitment/useCarrierQuestions";

/**
 * Settings → Recruiting → "The application form" → "Your own questions" (HIRING-WORKFLOW-AUDIT-2026-10-31
 * §15.3 D-CQ1, CQ2; the table is 0567).
 *
 * A carrier adds a question with its wording, an optional hint, what kind of answer it wants and — for "one
 * of a list" — its choices, and whether it is required. Applicants are asked them after the built-in
 * questions, in these words on the Spanish page too (D-CQ4).
 *
 * ⚠ **What a question asks never changes once saved** — wording, kind, choices (0567's CQ011): an answer
 * must stay readable beside exactly the question asked. The screen says so before the save, and offers only
 * what may change after it: the hint, required, the order, or removing it. Removing RETIRES it (CQ010):
 * applicants already sent the form are still asked it, because they answer the set stamped on their
 * invitation at the first Send (D-CQ2), and it still prints on every application that asked it.
 *
 * The limits are the contract's (D-CQ5) — 20 live questions, checked again by the database (CQ013).
 * Writes on `session.can("recruitment")`, what the api's POST and PATCH ask.
 */
const session = useSessionStore();
const toast = useToastStore();
const ask = useConfirm();
const canManage = computed(() => session.can("recruitment"));
const questionsQ = useCarrierQuestions();
const add = useAddCarrierQuestion();
const update = useUpdateCarrierQuestion();

const questions = computed(() => questionsQ.data.value ?? []);
const full = computed(() => questions.value.length >= CARRIER_QUESTIONS_LIVE_MAX);
const KIND_OPTIONS = CARRIER_QUESTION_KINDS.map((k) => ({ value: k, label: CARRIER_QUESTION_KIND_LABELS[k] }));

const blank = () => ({ wording: "", hint: "", kind: "boolean" as CarrierQuestionKind, choices: "", required: false });
const form = reactive(blank());
/** One choice per line — the list is short and the words are the stored answer, so plain lines say it best. */
const choiceLines = (raw: string): string[] => raw.split("\n").map((c) => c.trim()).filter((c) => c !== "");
const parsed = computed(() =>
  carrierQuestionCreateSchema.safeParse({
    wording: form.wording,
    hint: form.hint,
    kind: form.kind,
    choices: form.kind === "select" ? choiceLines(form.choices) : null,
    required: form.required,
  }),
);
const issueAt = (key: string) =>
  !parsed.value.success ? parsed.value.error.issues.find((i) => i.path[0] === key)?.message : undefined;
const wordingError = computed(() => (form.wording !== "" ? issueAt("wording") : undefined));
const hintError = computed(() => (form.hint !== "" ? issueAt("hint") : undefined));
const choicesError = computed(() => (form.kind === "select" && form.choices.trim() !== "" ? issueAt("choices") : undefined));

const describe = (q: CarrierQuestion): string =>
  [
    CARRIER_QUESTION_KIND_LABELS[q.kind],
    q.kind === "select" && q.choices ? q.choices.join(" / ") : null,
    q.required ? "Required" : "Optional — the applicant may say they would rather not",
  ].filter(Boolean).join(" · ");

async function submit(): Promise<void> {
  if (!parsed.value.success || full.value) return;
  try {
    await add.mutateAsync(parsed.value.data);
    Object.assign(form, blank());
    toast.success("Question added", "Applicants sent the form from now on are asked it.");
  } catch (e) {
    toast.error("Could not add the question", e instanceof Error ? e.message : undefined);
  }
}

async function change(q: CarrierQuestion, patch: Record<string, unknown>): Promise<boolean> {
  const checked = carrierQuestionUpdateSchema.safeParse(patch);
  if (!checked.success) {
    toast.error("Could not change the question", checked.error.issues[0]?.message);
    return false;
  }
  try {
    await update.mutateAsync({ id: q.id, patch: checked.data });
    return true;
  } catch (e) {
    toast.error("Could not change the question", e instanceof Error ? e.message : undefined);
    return false;
  }
}

/**
 * Move one place up or down. The whole list is renumbered 0..n-1 in its new order and only the rows whose
 * place changed are written — positions saved before (or equal) cannot leave two questions tied.
 */
async function move(index: number, by: -1 | 1): Promise<void> {
  const order = [...questions.value];
  const target = index + by;
  if (target < 0 || target >= order.length) return;
  [order[index], order[target]] = [order[target]!, order[index]!];
  for (const [position, q] of order.entries()) {
    if (q.position !== position && !(await change(q, { position }))) return;
  }
}

const editingHint = ref<string | null>(null);
const hintDraft = ref("");
function editHint(q: CarrierQuestion): void {
  editingHint.value = q.id;
  hintDraft.value = q.hint ?? "";
}
async function saveHint(q: CarrierQuestion): Promise<void> {
  if (await change(q, { hint: hintDraft.value })) editingHint.value = null;
}

async function remove(q: CarrierQuestion): Promise<void> {
  const yes = await ask({
    title: `Remove “${q.wording}”?`,
    message:
      "Applicants sent the form from now on are not asked it. Anybody already sent the form is still asked it, "
      + "and it stays on every application that asked it.",
    confirmLabel: "Remove",
    tone: "danger",
  });
  if (!yes) return;
  if (await change(q, { retire: true })) toast.success("Question removed");
}
</script>

<template>
  <div class="space-y-6" data-testid="carrier-questions-editor">
    <QueryState
      :loading="questionsQ.isLoading.value"
      :error="questionsQ.isError.value ? questionsQ.error.value : null"
      error-text="Could not load your questions."
      :retrying="questionsQ.isFetching.value"
      loading-text="Loading your questions…"
      compact
      @retry="questionsQ.refetch()"
    >
      <div class="space-y-2">
        <div class="flex items-baseline justify-between gap-4">
          <h3 class="text-sm font-semibold text-ink">Your own questions</h3>
          <p class="text-xs text-ink-muted" data-testid="question-count">{{ questions.length }} of {{ CARRIER_QUESTIONS_LIVE_MAX }}</p>
        </div>
        <p class="text-xs text-ink-secondary">
          Asked after the built-in questions, in your words — on the Spanish form too. Each applicant is asked the questions
          as they stood when you first sent them the form.
        </p>
        <p v-if="questions.length === 0" class="text-xs text-ink-secondary" data-testid="no-questions">
          No questions of your own yet.
        </p>
        <ul v-else class="divide-y divide-edge">
          <li v-for="(q, i) in questions" :key="q.id" class="space-y-2 py-2" data-testid="carrier-question">
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <p class="text-sm font-medium text-ink">{{ q.wording }}</p>
                <p class="text-xs text-ink-muted">{{ describe(q) }}</p>
                <p v-if="q.hint && editingHint !== q.id" class="text-xs text-ink-secondary">Hint: {{ q.hint }}</p>
              </div>
              <div v-if="canManage" class="flex shrink-0 flex-wrap items-center justify-end gap-2">
                <AppCheckbox
                  :model-value="q.required"
                  label="Required"
                  :disabled="update.isPending.value"
                  @update:model-value="(v: boolean) => change(q, { required: v })"
                />
                <BaseButton size="sm" variant="ghost" :disabled="update.isPending.value || i === 0" :aria-label="`Move “${q.wording}” up`" @click="move(i, -1)">Up</BaseButton>
                <BaseButton size="sm" variant="ghost" :disabled="update.isPending.value || i === questions.length - 1" :aria-label="`Move “${q.wording}” down`" @click="move(i, 1)">Down</BaseButton>
                <BaseButton size="sm" variant="ghost" :disabled="update.isPending.value" @click="editHint(q)">Hint</BaseButton>
                <BaseButton size="sm" variant="ghost" :disabled="update.isPending.value" @click="remove(q)">Remove</BaseButton>
              </div>
            </div>
            <div v-if="editingHint === q.id" class="flex items-end gap-2" data-testid="hint-editor">
              <FormField v-slot="{ id }" label="Hint" hint="Shown under the question. Leave empty for none." class="min-w-0 flex-1">
                <BaseInput :id="id" v-model="hintDraft" />
              </FormField>
              <BaseButton size="sm" variant="primary" :disabled="update.isPending.value" @click="saveHint(q)">Save</BaseButton>
              <BaseButton size="sm" variant="ghost" @click="editingHint = null">Cancel</BaseButton>
            </div>
          </li>
        </ul>
      </div>

      <div v-if="canManage" class="space-y-3 border-t border-edge pt-4" data-testid="add-question">
        <h3 class="text-sm font-semibold text-ink">Add a question</h3>
        <p class="text-xs text-ink-secondary" data-testid="frozen-note">
          The wording, the kind of answer and the choices cannot change once the question is saved, so every answer stays
          beside the question that was asked. To change one, remove it and add a new one.
        </p>
        <p v-if="full" class="text-xs text-ink-secondary" data-testid="questions-full">
          You ask {{ CARRIER_QUESTIONS_LIVE_MAX }} questions of your own, the most there can be. Remove one to add another.
        </p>
        <template v-else>
          <FormField v-slot="{ id }" label="Question" :error="wordingError">
            <BaseInput :id="id" v-model="form.wording" placeholder="Do you have a pet that travels with you?" />
          </FormField>
          <FormField v-slot="{ id }" label="Hint" hint="Optional. Shown under the question." :error="hintError">
            <BaseInput :id="id" v-model="form.hint" />
          </FormField>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField v-slot="{ id }" label="Kind of answer">
              <AppSelect :id="id" v-model="form.kind" :options="KIND_OPTIONS" />
            </FormField>
            <div class="flex items-end pb-2">
              <AppCheckbox v-model="form.required" label="Required" />
            </div>
          </div>
          <FormField
            v-if="form.kind === 'select'"
            v-slot="{ id }"
            label="Choices"
            hint="One per line, at least two. The applicant picks one."
            :error="choicesError"
          >
            <AppTextarea :id="id" v-model="form.choices" :rows="4" />
          </FormField>
          <BaseButton variant="primary" size="sm" :disabled="!parsed.success || add.isPending.value" @click="submit">
            {{ add.isPending.value ? "Adding…" : "Add the question" }}
          </BaseButton>
        </template>
      </div>
    </QueryState>
  </div>
</template>
