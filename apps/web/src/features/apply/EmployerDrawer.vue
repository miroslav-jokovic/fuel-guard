<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  AppButton as BaseButton,
  AppCheckbox as BaseCheckbox,
  AppDateField,
  AppInput as BaseInput,
} from "@silvicom/ui";
import {
  applicationEmployerSchema,
  applicationV2FilingIssues,
  employmentSegments,
  type ApplicationEmployer,
} from "@silvicom/shared";
import SlideOver from "@/components/SlideOver.vue";
import ApplyField from "@/features/apply/ApplyField.vue";
import EmployerQuestions from "@/features/apply/EmployerQuestions.vue";
import EmployerWhereFields from "@/features/apply/EmployerWhereFields.vue";
import { provideApplyIssues } from "@/features/apply/issues";
import { describeField, fieldId, messageFor, valueAt, type FieldPath } from "@/features/apply/fieldLabels";
import type { SectionIssue } from "@/features/apply/useApplicationWizard";
import { emptyEmployer, toEmployerPayload, type DraftEmployer } from "@/features/apply/draft";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * One job, on its own (X5, D-AX2).
 *
 * ── WHY A JOB IS NOT A CARD ON A LIST ANY MORE ────────────────────────────────────────────────
 * The employment screen carried fifteen controls per employer, five per equipment row and two of its
 * own. A six-employer ten-year history — ordinary in this industry, not a tail case — was **107
 * controls on one screen**, on a form whose own page header says nine in ten are filled in on a
 * phone. `ApplyPage`'s docstring promises "one §391.21(b) paragraph at a time"; that screen was the
 * paragraph repeated six times with no way to tell where one job ended and the next began.
 *
 * ── ONE EMPLOYER PER SCREEN, ON A V2 LINK (C3c2b, §6.4 item 4) ────────────────────────────────
 * This panel already WAS one employer per screen — the list is the add-another loop's hub and the
 * panel its page — so C3c2b reworks it rather than replacing it. What changed is what the panel asks
 * on a v2 link, where a filing refuses a job without its address, its reason for leaving and, for a
 * job in the last three years, §391.21(b)(10)(iv)'s two answers (AW1): those are asked in the main
 * run, in §6.4's order — name, from, to, address, reason, the two (iv) questions, drove a CMV — and
 * Save checks them with the filing's own rules, so a job cannot go back on the list in a state the
 * filing would refuse. A legacy link is asked none of that at filing (plan §7), so its panel keeps
 * the owner's 2026-09-11 shape: three fields and "More about this job (optional)".
 *
 * ── WHY IT EDITS A COPY ───────────────────────────────────────────────────────────────────────
 * The panel commits on Save and discards on Cancel, so a driver who opens the wrong job and backs
 * out has changed nothing. Binding straight to the draft row would autosave every keystroke of an
 * edit they abandoned, and "Cancel" would be a button that does nothing.
 *
 * ── AND WHY IT VALIDATES ITSELF ───────────────────────────────────────────────────────────────
 * One job's answers are checked when that job is saved, against `applicationEmployerSchema` — the
 * server's own row schema — and on a v2 link then against `applicationV2FilingIssues`, the filing's
 * own rules, for this row alone. The alternative is what the form did before: collect six jobs, press
 * Next, and hand back a list of everything wrong with all of them at once.
 *
 * The issues are `provide`d into this subtree, so `ApplyField` inside the panel finds the panel's
 * errors and not the page's. Same component, same paths, different scope — which is what
 * provide/inject is for.
 */
const props = withDefaults(
  defineProps<{
    open: boolean;
    index: number;
    employer: DraftEmployer | null;
    /** The carrier's day on a v2 link, null on a legacy one — `v2FilingIssues`'s argument, and meaning. */
    v2AsOf?: string | null;
  }>(),
  { v2AsOf: null },
);
const emit = defineEmits<{ save: [DraftEmployer]; remove: []; close: [] }>();

const copy = APPLY_COPY.employment;

/** The working copy. Replaced whenever the panel opens on a different row. */
const local = ref<DraftEmployer>(emptyEmployer());
const issues = ref<SectionIssue[]>([]);
provideApplyIssues(issues);

/** Only an existing job can be removed; a new one is discarded by Cancel and leaves no row. */
const savedAlready = computed(() => (props.employer?.employer_name ?? "").trim() !== "");

const title = computed(() =>
  props.employer?.employer_name.trim() ? props.employer.employer_name.trim() : copy.drawerNew,
);

/**
 * Is this job one of (b)(10)'s — in the last three years — by the dates typed so far? The filing's own
 * test (`employmentSegments`), on the same day, so the panel asks (iv) of exactly the jobs the filing
 * refuses without it. No start date yet, no answer: the questions appear once the dates above are in.
 */
const inLastThreeYears = computed(() => {
  if (!props.v2AsOf || local.value.started_on === "") return false;
  const row = toEmployerPayload(local.value) as Pick<ApplicationEmployer, "started_on" | "ended_on" | "operated_cmv">;
  return employmentSegments(row, props.v2AsOf).includes("b10");
});

/** A problem at a path inside this row, in the page's vocabulary — the same label, id and sentence. */
function rowIssue(field: FieldPath, message: string, say: string): SectionIssue {
  const path = ["employers", props.index, ...field];
  return { path, key: "employers", message, label: describeField(path), say, fieldId: fieldId(path), section: "employment" };
}

/** Everything wrong with the job as it stands: the row schema, then (v2) the filing's rules for it. */
function check(): SectionIssue[] {
  const candidate = toEmployerPayload(local.value);
  const parsed = applicationEmployerSchema.safeParse(candidate);
  if (!parsed.success) {
    // Paths come back relative to the row (`["city"]`); they are rebased onto the document
    // (`["employers", 2, "city"]`) so the label, the id and the message are the SAME ones the page
    // would produce for that field. Two vocabularies for one box is how a form starts contradicting
    // itself. The value comes from the ORIGINAL, row-relative path — the rebased one describes a
    // document this panel does not hold.
    return parsed.error.issues.map((issue) => {
      const field = issue.path as (string | number)[];
      const say = messageFor({ ...issue, path: ["employers", props.index, ...field] }, valueAt(candidate, field));
      return rowIssue(field, issue.message, say);
    });
  }
  if (!props.v2AsOf) return [];
  // The filing's rules over this one job: filed as the only employer, so its issues are `employers.0.*`,
  // and the address and gap rules — about the whole application, not this row — are left to the screen.
  return applicationV2FilingIssues({ employers: [parsed.data], employment_gaps: [], addresses: [] }, props.v2AsOf)
    .filter((issue) => issue.path.startsWith("employers.0."))
    .map((issue) => rowIssue([issue.path.slice("employers.0.".length)], issue.message, issue.message));
}

watch(
  () => [props.open, props.index] as const,
  ([open]) => {
    if (!open) return;
    local.value = { ...(props.employer ?? emptyEmployer()) };
    // A saved job reopened on a v2 link shows at once what the filing still wants from it — which is
    // why the list said "Some answers are missing". A new job starts clean; Save is where it is judged.
    issues.value = props.v2AsOf && savedAlready.value ? check() : [];
  },
  { immediate: true },
);

function save(): void {
  issues.value = check();
  if (issues.value.length > 0) {
    const first = globalThis.document?.getElementById(issues.value[0]!.fieldId);
    first?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    first?.focus?.();
    return;
  }
  emit("save", { ...local.value });
}
</script>

<template>
  <SlideOver :open="open" :title="title" :description="copy.drawerIntro" size="lg" @close="emit('close')">
    <div v-if="open" class="space-y-4">
      <!-- ── WHAT THE REGULATION ACTUALLY NEEDS, AND NOTHING ELSE ABOVE THE FOLD ───────────────
           Reported by the owner 2026-09-11: *"most of the drivers are not remembering all places
           and exact company names, so this should be much simpler with company name, and dates from
           to he worked there, all other things are optional."*

           They were right, and the form was lying about itself: `applicationEmployerSchema` has only
           ever required `employer_name` and `started_on`. Every other text field is already
           `.nullish()`. Fifteen controls in one column simply LOOKED mandatory, so a driver who
           could not remember a former dispatcher's phone number stalled on a question nothing was
           asking them. Three fields now, and the rest behind a disclosure that says it is optional.

           On a v2 link (C3c2b) the filing DOES require more — see the header — so what it requires is
           asked here, next, and only what is still optional is behind the disclosure. -->
      <ApplyField v-slot="f" :path="['employers', index, 'employer_name']" :label="copy.employer" :hint="copy.employerHint">
        <BaseInput v-bind="f" v-model="local.employer_name" />
      </ApplyField>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ApplyField v-slot="f" :path="['employers', index, 'started_on']" :label="copy.from">
          <AppDateField v-bind="f" v-model="local.started_on" />
        </ApplyField>
        <ApplyField
          v-slot="f"
          :path="['employers', index, 'ended_on']"
          :label="copy.to"
          :hint="copy.toHint"
        >
          <AppDateField v-bind="f" v-model="local.ended_on" />
        </ApplyField>
      </div>

      <template v-if="v2AsOf">
        <EmployerWhereFields v-model="local" :index="index" />
        <EmployerQuestions v-model="local" :index="index" :ask-whether="inLastThreeYears" />
      </template>

      <!-- `<details>` is this product's disclosure — `VerdictDetails.vue` is the precedent — rather
           than a new primitive for one screen. Closed by default: a driver who has nothing more to
           add never opens it. -->
      <details class="rounded-surface bg-surface-muted p-4">
        <summary class="cursor-pointer py-3 text-sm font-medium text-ink">{{ copy.moreAboutJob }}</summary>
        <p class="mt-1 text-xs text-ink-muted">{{ copy.moreAboutJobHint }}</p>

        <div class="mt-4 space-y-4">
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ApplyField v-slot="f" :path="['employers', index, 'position_held']" :label="copy.position">
              <BaseInput v-bind="f" v-model="local.position_held" />
            </ApplyField>
            <ApplyField
              v-slot="f"
              :path="['employers', index, 'usdot_number']"
              :label="copy.usdot"
              :hint="copy.usdotHint"
            >
              <BaseInput v-bind="f" v-model="local.usdot_number" />
            </ApplyField>
          </div>

          <EmployerWhereFields v-if="!v2AsOf" v-model="local" :index="index" />

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ApplyField
              v-slot="f"
              :path="['employers', index, 'phone']"
              :label="copy.phone"
              :hint="copy.phoneHint"
            >
              <BaseInput v-bind="f" v-model="local.phone" type="tel" />
            </ApplyField>
            <ApplyField
              v-slot="f"
              :path="['employers', index, 'email']"
              :label="copy.email"
              :hint="copy.emailHint"
            >
              <BaseInput v-bind="f" v-model="local.email" type="email" />
            </ApplyField>
          </div>

          <!-- ⚠ `operated_cmv` and `dot_regulated` default TRUE. The consequence is worth writing
               down: a warehouse job from six years ago left at the default is counted as a
               §391.21(b)(11) employer it was not. That over-reports — the paragraph asks only for CMV
               jobs, and listing one extra breaks nothing — where asking every driver to classify every
               job they have ever had loses the job entirely. The office corrects it at review. -->
          <div class="space-y-2">
            <p class="text-sm font-medium text-ink">{{ copy.aboutThisJob }}</p>
            <EmployerQuestions v-if="!v2AsOf" v-model="local" :index="index" ask-whether />
            <BaseCheckbox v-model="local.dot_regulated">{{ copy.dotRegulated }}</BaseCheckbox>
          </div>
        </div>
      </details>
    </div>

    <template #footer>
      <!-- ⚠ Remove lives HERE and not on the list row. On the list it sat a thumb's width from
           "Change" at 390px, and the two actions are not equally undoable — a job carries fifteen
           answers and there is no undo. In the panel the driver is looking at the job they are about
           to delete, and it is a separate reach from the primary action. -->
      <div class="flex flex-wrap items-center justify-between gap-3">
        <BaseButton v-if="savedAlready" variant="ghost" size="touch" @click="emit('remove')">
          {{ copy.removeJob }}
        </BaseButton>
        <span v-else />
        <div class="flex items-center gap-3">
          <BaseButton variant="secondary" size="touch" @click="emit('close')">{{ copy.drawerCancel }}</BaseButton>
          <BaseButton variant="primary" size="touch" @click="save">{{ copy.drawerSave }}</BaseButton>
        </div>
      </div>
    </template>
  </SlideOver>
</template>
