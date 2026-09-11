<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  AppButton as BaseButton,
  AppCheckbox as BaseCheckbox,
  AppCombobox as ComboSelect,
  AppDateField,
  AppInput as BaseInput,
} from "@silvicom/ui";
import { applicationEmployerSchema, jurisdictionOptions } from "@silvicom/shared";
import SlideOver from "@/components/SlideOver.vue";
import ApplyField from "@/features/apply/ApplyField.vue";
import { provideApplyIssues } from "@/features/apply/issues";
import { describeField, fieldId, messageFor, valueAt } from "@/features/apply/fieldLabels";
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
 * ── WHY IT EDITS A COPY ───────────────────────────────────────────────────────────────────────
 * The panel commits on Save and discards on Cancel, so a driver who opens the wrong job and backs
 * out has changed nothing. Binding straight to the draft row would autosave every keystroke of an
 * edit they abandoned, and "Cancel" would be a button that does nothing.
 *
 * ── AND WHY IT VALIDATES ITSELF ───────────────────────────────────────────────────────────────
 * One job's fifteen answers are checked when that job is saved, against `applicationEmployerSchema` —
 * the server's own row schema. The alternative is what the form did before: collect six jobs, press
 * Next, and hand back a list of everything wrong with all of them at once.
 *
 * The issues are `provide`d into this subtree, so `ApplyField` inside the panel finds the panel's
 * errors and not the page's. Same component, same paths, different scope — which is what
 * provide/inject is for.
 */
const props = defineProps<{ open: boolean; index: number; employer: DraftEmployer | null }>();
const emit = defineEmits<{ save: [DraftEmployer]; remove: []; close: [] }>();

const copy = APPLY_COPY.employment;
const JURISDICTIONS = jurisdictionOptions();

/** The working copy. Replaced whenever the panel opens on a different row. */
const local = ref<DraftEmployer>(emptyEmployer());
const issues = ref<SectionIssue[]>([]);
provideApplyIssues(issues);

watch(
  () => [props.open, props.index] as const,
  ([open]) => {
    if (!open) return;
    local.value = { ...(props.employer ?? emptyEmployer()) };
    issues.value = [];
  },
  { immediate: true },
);

/** Only an existing job can be removed; a new one is discarded by Cancel and leaves no row. */
const savedAlready = computed(() => (props.employer?.employer_name ?? "").trim() !== "");

const title = computed(() =>
  props.employer?.employer_name.trim() ? props.employer.employer_name.trim() : copy.drawerNew,
);

function save(): void {
  const candidate = toEmployerPayload(local.value);
  const parsed = applicationEmployerSchema.safeParse(candidate);
  if (!parsed.success) {
    // Paths come back relative to the row (`["city"]`); they are rebased onto the document
    // (`["employers", 2, "city"]`) so the label, the id and the message are the SAME ones the page
    // would produce for that field. Two vocabularies for one box is how a form starts contradicting
    // itself.
    issues.value = parsed.error.issues.map((issue) => {
      const path = ["employers", props.index, ...(issue.path as (string | number)[])];
      return {
        path,
        key: "employers",
        message: issue.message,
        label: describeField(path),
        // The value comes from the ORIGINAL, row-relative path — the rebased one describes a
        // document this panel does not hold.
        say: messageFor({ ...issue, path }, valueAt(candidate, issue.path as (string | number)[])),
        fieldId: fieldId(path),
        section: "employment" as const,
      };
    });
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
      <ApplyField v-slot="f" :path="['employers', index, 'employer_name']" :label="copy.employer">
        <BaseInput v-bind="f" v-model="local.employer_name" />
      </ApplyField>

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
          <BaseInput v-bind="f" v-model="local.usdot_number" placeholder="Optional" />
        </ApplyField>
      </div>

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

      <ApplyField
        v-slot="f"
        :path="['employers', index, 'address_line1']"
        :label="copy.address"
        :hint="copy.addressHint"
      >
        <BaseInput v-bind="f" v-model="local.address_line1" />
      </ApplyField>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ApplyField v-slot="f" :path="['employers', index, 'city']" :label="copy.city">
          <BaseInput v-bind="f" v-model="local.city" />
        </ApplyField>
        <ApplyField v-slot="f" :path="['employers', index, 'state']" :label="copy.state">
          <ComboSelect v-bind="f" v-model="local.state" :options="JURISDICTIONS" />
        </ApplyField>
      </div>

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
          <BaseInput v-bind="f" v-model="local.email" type="email" placeholder="Optional" />
        </ApplyField>
      </div>

      <ApplyField
        v-slot="f"
        :path="['employers', index, 'reason_for_leaving']"
        :label="copy.reason"
        :hint="copy.reasonHint"
      >
        <BaseInput v-bind="f" v-model="local.reason_for_leaving" />
      </ApplyField>

      <div class="space-y-2 rounded-surface bg-surface-muted p-4">
        <p class="text-sm font-medium text-ink">{{ copy.aboutThisJob }}</p>
        <BaseCheckbox v-model="local.operated_cmv">{{ copy.operatedCmv }}</BaseCheckbox>
        <BaseCheckbox v-model="local.dot_regulated">{{ copy.dotRegulated }}</BaseCheckbox>
        <!-- §40.25(j): asked of the applicant because the answer is theirs, and a yes changes what
             §40.25 obliges the carrier to chase from that employer. -->
        <BaseCheckbox v-model="local.safety_sensitive">{{ copy.safetySensitive }}</BaseCheckbox>
        <BaseCheckbox v-model="local.subject_to_fmcsr">{{ copy.subjectToFmcsr }}</BaseCheckbox>
      </div>
    </div>

    <template #footer>
      <!-- ⚠ Remove lives HERE and not on the list row. On the list it sat a thumb's width from
           "Change" at 390px, and the two actions are not equally undoable — a job carries fifteen
           answers and there is no undo. In the panel the driver is looking at the job they are about
           to delete, and it is a separate reach from the primary action. -->
      <div class="flex flex-wrap items-center justify-between gap-3">
        <BaseButton v-if="savedAlready" variant="ghost" @click="emit('remove')">
          {{ copy.removeJob }}
        </BaseButton>
        <span v-else />
        <div class="flex items-center gap-3">
          <BaseButton variant="secondary" @click="emit('close')">{{ copy.drawerCancel }}</BaseButton>
          <BaseButton variant="primary" @click="save">{{ copy.drawerSave }}</BaseButton>
        </div>
      </div>
    </template>
  </SlideOver>
</template>
