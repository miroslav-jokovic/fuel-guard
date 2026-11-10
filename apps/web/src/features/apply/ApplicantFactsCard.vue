<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
import { AppButton as BaseButton, AppFormField as FormField, AppSearchField, AppTextarea as BaseTextarea } from "@silvicom/ui";
import {
  formatDisplayDate,
  formatDisplayMonth,
  jurisdictionName,
  questionnaireForApplicant,
} from "@silvicom/shared";
import { formatPhone } from "@/lib/format";
import { useToastStore } from "@/stores/toast";
import FactEditor from "./FactEditor.vue";
import { fieldId } from "./fieldLabels";
import { APPLY_SECTION_TITLES } from "./strings";
import { applicantFactRows, factSections, matchingFacts, type FactRow } from "./applicantFactRows";
import { correctionFor, type FactValue } from "./factCorrection";
import {
  useCorrectIdentityFromReview,
  useCorrectPartOne,
  useCorrectPartOneAnswer,
  useEditApplicationAnswer,
  type ApplicationReview,
} from "./useApplicationReview";

/**
 * "Applicant facts": every answer the driver gave, once, with an Edit beside it (APPLICATION-FIX-PLAN
 * F3; owner D-AM7 and Q-AM13 — "we should be able to edit each answer because drivers make mistakes").
 *
 * ── ONE CARD, WHATEVER WRITER HOLDS THE ANSWER ────────────────────────────────────────────────
 * It replaces "Correct an answer" (`ApplicationAnswerList`, a text box per stored value) and the Part 1
 * form (`PartOneCorrection`) on the review drawer. Each row knows its door (`applicantFactRows`): the
 * draft, the identity or Part 1. The recruiter does not need to know which. Every door now writes an
 * `application_edits` row, so every correction reaches the driver's signing screen (E7).
 *
 * ── ONE ANSWER AT A TIME ──────────────────────────────────────────────────────────────────────
 * One row is open at once, and Save sends that one answer. Each correction is its own act with its own
 * before and after, which is what the driver reads on 3.1 — a form saving twelve fields at once would
 * be twelve rows the driver cannot tell apart from one mistake.
 *
 * ⚠ What was typed stays on screen until the server holds it (F0, E9): a refusal (a stale revision,
 * an answer the contract rejects) leaves the row open with the reason under it.
 *
 * ── THE OWNER'S TWO EXCEPTIONS (Q-AM13) ───────────────────────────────────────────────────────
 * - The driver's own drug-and-alcohol statements (`rule: "statement"`) change only with a reason, typed
 *   here and shown to the driver beside the change on 3.1. Save stays off until there is one.
 * - The donor gender (`rule: "replace_only"`) is never shown: the row says whether one was given, the
 *   editor opens empty, and the edit row records only that it was replaced.
 */
const props = defineProps<{
  invitationId: string;
  review: ApplicationReview;
  /**
   * Which doors are open for THIS reader (the drawer decides; `session.can("recruitment")` is in both):
   * - `draftOpen`: the draft's window, from the office's Send until the first packet mark (§9 P5);
   * - `recordOpen`: Part 1 and the identity, corrected while the office screens — before the form is
   *   even sent — until the first packet mark (`applicationEditLog.ts`).
   */
  draftOpen: boolean;
  recordOpen: boolean;
}>();
const canEdit = (row: FactRow): boolean => (row.door === "draft" ? props.draftOpen : props.recordOpen);

const toast = useToastStore();
const id = toRef(props, "invitationId");
const draftEdit = useEditApplicationAnswer(id);
const partOneEdit = useCorrectPartOne(id);
const answerEdit = useCorrectPartOneAnswer(id);
const identityEdit = useCorrectIdentityFromReview(id);
const pending = computed(() =>
  draftEdit.isPending.value || partOneEdit.isPending.value || identityEdit.isPending.value || answerEdit.isPending.value);

const rows = computed(() =>
  applicantFactRows({
    payload: props.review.payload,
    partOne: props.review.partOne,
    edits: props.review.edits,
    questionnaire: questionnaireForApplicant(),
    partOneAnswers: props.review.partOneAnswers,
  }),
);
const query = ref("");
const sections = computed(() => factSections(matchingFacts(rows.value, query.value)));

const open = ref<string | null>(null);
const typed = ref<FactValue>(null);
const note = ref("");
const problem = ref<string | null>(null);

// The drawer swaps applicants without unmounting; a half-typed correction must not carry over.
watch(id, () => { open.value = null; });

/**
 * What the editor opens holding: the answer as a person types it. ⚠ A phone opens as "(312) 555-0142",
 * never Part 1's stored "+13125550142" — E8's stored-format box, caught in the F3 browser pass. Both
 * routes take the typed form (`usMobilePhoneSchema` normalises it).
 */
function editText(row: FactRow): FactValue {
  // Replace-only: the editor never opens holding the answer it may not show (Q-AM13).
  if (row.rule === "replace_only") return null;
  if (Array.isArray(row.value)) return [...row.value].map(String);
  if (typeof row.value === "boolean") return row.value;
  if (row.value === null || row.value === "") return null;
  if (row.input === "phone" || row.input === "us_mobile") return formatPhone(String(row.value));
  return String(row.value);
}

function edit(row: FactRow): void {
  open.value = row.key;
  typed.value = editText(row);
  note.value = "";
  problem.value = null;
}

const changed = (row: FactRow): boolean => {
  const now = typeof typed.value === "string" && typed.value.trim() === "" ? null : typed.value;
  // A blind replace is a change once anything is chosen: the office cannot know what it repeats.
  if (row.rule === "replace_only") return now !== null;
  return JSON.stringify(editText(row)) !== JSON.stringify(now);
};
/** Save waits for a reason on a statement, as the API does — said on the button's row, not after a refusal. */
const ready = (row: FactRow): boolean => changed(row) && (row.rule !== "statement" || note.value.trim() !== "");

async function save(row: FactRow): Promise<void> {
  const correction = correctionFor(row, typed.value, {
    revision: props.review.revision ?? 0,
    partOne: props.review.partOne,
    rows: rows.value,
    addresses: (props.review.payload as { addresses?: unknown } | null)?.addresses,
  }, note.value);
  if ("problem" in correction) {
    problem.value = correction.problem;
    return;
  }
  try {
    if (correction.door === "draft") await draftEdit.mutateAsync(correction.edit);
    else if (correction.door === "identity") await identityEdit.mutateAsync(correction.identity);
    else if (correction.door === "part_one_answer") await answerEdit.mutateAsync(correction.answer);
    else await partOneEdit.mutateAsync(correction.body);
    open.value = null;
    toast.push("success", "Answer corrected", "The applicant is shown this change before they sign.");
  } catch (e) {
    problem.value = e instanceof Error ? e.message : "That change could not be saved.";
  }
}

/** An answer as the office reads it — the way the driver gave it, never the stored format. */
function shown(row: FactRow): string {
  if (row.rule === "replace_only") return row.given ? "Given — not shown to the office" : "Not answered";
  const v = row.value;
  if (Array.isArray(v)) return v.length === 0 ? "None" : v.map((c) => row.choices?.find((x) => x.value === c)?.label ?? String(c)).join(", ");
  if (v === null || v === undefined || v === "") return "Not answered";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  const s = String(v);
  switch (row.input) {
    case "date": return formatDisplayDate(s);
    case "month": return formatDisplayMonth(s);
    case "us_state":
    case "jurisdiction": { const name = jurisdictionName(s); return name ? `${name} (${s})` : s; }
    case "phone":
    case "us_mobile": return formatPhone(s);
    case "miles": return Number.isFinite(Number(s)) ? Number(s).toLocaleString("en-US") : s;
    case "choice": return row.choices?.find((c) => c.value === s)?.label ?? s;
    default: return s;
  }
}
</script>

<template>
  <section class="space-y-3" data-applicant-facts>
    <div>
      <h3 class="text-sm font-semibold text-ink">Applicant facts</h3>
      <p class="mt-1 text-xs text-ink-muted">
        Every answer the applicant gave. Correct any of them until they start signing — they are shown each
        change and accept it before they sign.
      </p>
    </div>

    <AppSearchField v-model="query" placeholder="Find an answer" aria-label="Find an answer" />
    <p v-if="sections.length === 0" class="text-sm text-ink-muted">
      Nothing matches “{{ query }}”. Try the words the applicant saw above the box.
    </p>

    <div v-for="group in sections" :key="group.section" class="space-y-1">
      <h4 class="text-xs font-semibold uppercase tracking-wider text-ink-muted">{{ APPLY_SECTION_TITLES[group.section] }}</h4>
      <ul class="divide-y divide-edge">
        <li v-for="row in group.rows" :key="row.key" class="py-2" :data-fact="row.key">
          <div v-if="open !== row.key" class="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
            <span class="min-w-0 text-sm text-ink-muted sm:w-56 sm:shrink-0">{{ row.label }}</span>
            <span
              class="min-w-0 flex-1 break-words text-sm"
              :class="row.rule === 'replace_only' || row.value === null || row.value === '' ? 'text-ink-tertiary' : 'text-ink'"
            >
              {{ shown(row) }}
              <span v-if="row.corrected" class="ml-2 text-2xs text-ink-tertiary" data-fact-corrected>Corrected by the office</span>
            </span>
            <BaseButton v-if="canEdit(row)" size="sm" variant="ghost" :disabled="open !== null" @click="edit(row)">
              Edit
            </BaseButton>
          </div>

          <div v-else class="space-y-2">
            <label v-if="row.input !== 'yesno'" :for="fieldId(row.path)" class="block text-sm text-ink-muted">{{ row.label }}</label>
            <FactEditor
              :id="fieldId(row.path)"
              v-model="typed"
              :input="row.input"
              :label="row.label"
              :choices="row.choices"
              :date-kind="row.path[0] === 'date_of_birth' ? 'dob' : undefined"
              :error="problem ?? undefined"
            />
            <p v-if="row.rule !== 'replace_only'" class="text-2xs text-ink-tertiary" data-fact-on-file>On file: {{ shown(row) }}</p>
            <p v-else class="text-2xs text-ink-tertiary" data-fact-blind>
              Not shown to you, so it does not reach whoever decides the hire. Choose the answer the applicant gives you.
            </p>
            <FormField
              v-if="row.rule === 'statement'"
              :id="`${fieldId(row.path)}-note`"
              label="Why you are changing it"
              hint="This is the applicant's own answer. They read your reason beside the change before they sign."
            >
              <template #default="f"><BaseTextarea v-bind="f" v-model="note" rows="2" data-fact-note /></template>
            </FormField>
            <div class="flex justify-end gap-2">
              <BaseButton size="sm" variant="ghost" @click="open = null">Cancel</BaseButton>
              <BaseButton size="sm" variant="primary" :disabled="pending || !ready(row)" @click="save(row)">Save</BaseButton>
            </div>
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>
