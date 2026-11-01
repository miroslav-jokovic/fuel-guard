<script setup lang="ts">
import { computed, ref, toRef } from "vue";
import { AppButton as BaseButton, AppInput as BaseInput } from "@silvicom/ui";
import { formatDisplayDate, type ApplicationPath } from "@silvicom/shared";
import EmploymentTimeline from "@/components/employment/EmploymentTimeline.vue";
import EmployerFormDrawer from "@/components/employment/EmployerFormDrawer.vue";
import { EMPLOYMENT_OFFICE_COPY } from "@/components/employment/employmentCopy";
import {
  employerFields,
  employerProblems,
  employerRecord,
  type EmployerFields,
} from "@/components/employment/employerRow";
import type { TimelineJob } from "@/components/employment/timeline";
import { ymd } from "@/lib/dateWindow";
import { useToastStore } from "@/stores/toast";
import { employerName } from "./officeJobs";
import { useEditApplicationAnswer } from "./useApplicationReview";

/**
 * The office's hand on the applicant's jobs before filing (HIRING-WORKFLOW-AUDIT-2026-10-31 §9 P5,
 * §4.5; the one timeline and the one employer form since HW5b).
 *
 * The same timeline the applicant sees, and the same form: add a job (with its street — EM-3), change
 * any answer, fill any blank one, remove a job after a confirm (by its key, Q-AX7), and explain a gap.
 * `AddEmployerForm` — a second form with its own fields — is gone.
 *
 * ── THE SAVE PATH IS P5's, UNCHANGED ──────────────────────────────────────────────────────────
 * Every write is an `editApplication` op naming the draft revision it was made against, so a change the
 * applicant made a second earlier on their phone is never written over (§8.1). A new job is ONE
 * `add_employer`; a changed job is one `set` per changed answer, because each correction is its own
 * line in `application_edits` and its own mark on the signing screen — and each `set` names the
 * revision the previous one returned. A job from before AW1 has no key: it is reached by position for
 * the first write, which gives it one (`withEmployerKeys`), and by that key from then on.
 */
const props = defineProps<{
  invitationId: string;
  employers: Record<string, unknown>[];
  givenGaps: Array<{ from: string; explanation?: string }>;
  revision: number;
  /** A v2 application (it has a Part 1) — whose filing asks each job for its address, reason and (iv). */
  v2: boolean;
  editable: boolean;
}>();

const toast = useToastStore();
const edit = useEditApplicationAnswer(toRef(props, "invitationId"));
const copy = {
  ...EMPLOYMENT_OFFICE_COPY,
  removeMessage: "It comes off the application. The applicant is shown the removal before they sign.",
};

/** The office's day — the review's gaps have always been measured against today (§9 P5). */
const asOf = ymd(new Date());
const v2AsOf = computed(() => (props.v2 ? asOf : null));

/** Each row with how a write reaches it: its key, or — keyless, from before AW1 — its position. */
const rows = computed(() =>
  props.employers.map((row, i) => {
    const keyed = typeof row.key === "string" && row.key !== "";
    const id = keyed ? (row.key as string) : `row-${i}`;
    // The form's key is the row's id, so the panel keeps its place across a refetch; `answers` drops it.
    return { row, ref: keyed ? (row.key as string) : i, id, fields: { ...employerFields(row), key: id } };
  }),
);

const jobs = computed<TimelineJob[]>(() =>
  rows.value.map(({ id, fields }) => ({
    key: id,
    name: fields.employer_name.trim(),
    startedOn: fields.started_on,
    endedOn: fields.ended_on || null,
    operatedCmv: fields.operated_cmv,
    dotRegulated: fields.dot_regulated,
    missing: new Set(employerProblems(fields, v2AsOf.value).map((p) => p.field)).size,
    unfinished: fields.employer_name.trim() === "" || fields.started_on === "",
  })),
);

const explanations = computed(() =>
  Object.fromEntries(props.givenGaps.filter((g) => g.explanation).map((g) => [g.from, g.explanation!])),
);

// ── the panel ────────────────────────────────────────────────────────────────────────────────
const open = ref(false);
const editingId = ref<string | null>(null);
const prefill = ref<Partial<EmployerFields> | null>(null);
const errors = ref<Record<string, string>>({});
const editing = computed(() => rows.value.find((r) => r.id === editingId.value) ?? null);
const saving = ref(false);

function openJob(id: string): void {
  editingId.value = id;
  prefill.value = null;
  errors.value = {};
  open.value = true;
}
function addJob(dates?: { started_on: string; ended_on: string }): void {
  editingId.value = null;
  prefill.value = dates ?? null;
  errors.value = {};
  open.value = true;
}

/** The job's answers as the contract holds them, without its key — the fields a `set` may name. */
const answers = (f: EmployerFields): Record<string, unknown> => {
  const { key: _key, ...rest } = employerRecord(f);
  return rest;
};

async function save(fields: EmployerFields): Promise<void> {
  const found: Record<string, string> = {};
  for (const p of employerProblems(fields, v2AsOf.value)) found[p.field] ??= p.message;
  errors.value = found;
  if (Object.keys(found).length > 0) return;

  saving.value = true;
  try {
    const target = editing.value;
    if (!target) {
      await edit.mutateAsync({ op: "add_employer", employer: employerRecord(fields), revision: props.revision });
      toast.push("success", `${employerName(employerRecord(fields))} added`);
    } else {
      const before = answers(target.fields);
      const after = answers(fields);
      let revision: number = props.revision;
      let ref: string | number = target.ref;
      for (const field of Object.keys(after)) {
        if (JSON.stringify(before[field] ?? null) === JSON.stringify(after[field] ?? null)) continue;
        const path: ApplicationPath = ["employers", ref, field];
        const done = await edit.mutateAsync({ path, value: after[field] ?? null, revision });
        revision = done.revision ?? revision + 1;
        // A keyless job was given its key by that write: every later one names it by the key.
        if (typeof ref === "number") {
          const minted = (done.payload?.employers as Array<{ key?: unknown }> | undefined)?.[ref]?.key;
          if (typeof minted === "string") ref = minted;
        }
      }
      toast.push("success", `${employerName(employerRecord(fields))} saved`);
    }
    open.value = false;
  } catch (e) {
    toast.push("error", e instanceof Error ? e.message : "That job could not be saved.");
  } finally {
    saving.value = false;
  }
}

/** §9 P5 (AF-4, Q-AX7): by its key, after the panel's confirm. A keyless job cannot be named safely. */
async function remove(): Promise<void> {
  const target = editing.value;
  if (!target || typeof target.ref !== "string") return;
  try {
    await edit.mutateAsync({ op: "remove_employer", key: target.ref, revision: props.revision });
    toast.push("success", `${employerName(target.row)} removed`);
    open.value = false;
  } catch (e) {
    toast.push("error", e instanceof Error ? e.message : "That job could not be removed.");
  }
}

// ── a gap, explained from the office's side ──────────────────────────────────────────────────
const gapDrafts = ref<Record<string, string>>({});
async function explainGap(gap: { from: string; to: string }): Promise<void> {
  const explanation = (gapDrafts.value[gap.from] ?? "").trim();
  if (!explanation) return;
  try {
    await edit.mutateAsync({ op: "explain_gap", gap: { from: gap.from, to: gap.to, explanation }, revision: props.revision });
    delete gapDrafts.value[gap.from];
    toast.push("success", "Gap explained");
  } catch (e) {
    toast.push("error", e instanceof Error ? e.message : "That explanation could not be saved.");
  }
}
</script>

<template>
  <section class="space-y-3" data-testid="jobs">
    <EmploymentTimeline
      :jobs="jobs"
      :as-of="asOf"
      :copy="copy"
      :explanations="explanations"
      :show-gaps="jobs.length > 0"
      :editable="editable"
      @edit="openJob"
      @add="addJob"
    >
      <template v-if="editable" #gap="{ gap }">
        <p v-if="explanations[gap.from]" class="text-sm text-ink-secondary">
          {{ copy.gapExplained }} {{ explanations[gap.from] }}
        </p>
        <div class="flex flex-col gap-2 sm:flex-row">
          <BaseInput
            :model-value="gapDrafts[gap.from] ?? ''"
            :aria-label="`What they were doing from ${formatDisplayDate(gap.from)}`"
            placeholder="For example: between jobs, school, caring for family"
            class="sm:flex-1"
            @update:model-value="gapDrafts[gap.from] = String($event)"
          />
          <BaseButton
            size="sm"
            :disabled="edit.isPending.value || !(gapDrafts[gap.from] ?? '').trim()"
            @click="explainGap(gap)"
          >
            {{ explanations[gap.from] ? "Replace" : copy.explainGap }}
          </BaseButton>
        </div>
      </template>
    </EmploymentTimeline>

    <BaseButton v-if="editable" size="sm" variant="secondary" @click="addJob()">Add a job</BaseButton>

    <EmployerFormDrawer
      :open="open"
      :employer="editing?.fields ?? null"
      :prefill="prefill"
      :copy="copy"
      id-prefix="office-employer"
      :as-of="asOf"
      :errors="errors"
      :removable="typeof editing?.ref === 'string'"
      :pending="saving || edit.isPending.value"
      description="The applicant is shown every change before they sign."
      @save="save"
      @remove="remove"
      @close="open = false"
    />
  </section>
</template>
