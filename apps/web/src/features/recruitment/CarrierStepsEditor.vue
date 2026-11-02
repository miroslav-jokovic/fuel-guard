<script setup lang="ts">
import { computed, reactive } from "vue";
import {
  CARRIER_STEP_ANCHORS,
  CARRIER_STEP_PROOF_LABELS,
  CARRIER_STEP_PROOFS,
  HIDEABLE_HIRING_STEPS,
  HIRE_REFUSES_WITHOUT,
  carrierStepCreateSchema,
  hiringStep,
  type CarrierStep,
  type CarrierStepProof,
  type HiringStepKey,
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
import { useAddCarrierStep, useCarrierSteps, useUpdateCarrierStep } from "@/features/recruitment/useCarrierSteps";
import { useRecruitingSettings, useSaveRecruitingSettings } from "@/features/recruitment/useRecruitingSettings";

/**
 * Settings → Recruiting's "Your hiring steps" (HIRING-WORKFLOW-AUDIT §10 CE2, 0545).
 *
 * Two halves, one question — what does hiring look like at THIS carrier:
 *   · the steps it adds (D-CE1): a name, what to do, after which built-in step, who owes it, what proves
 *     it (D-CE2), and whether the hire waits for it (D-CE6);
 *   · the built-in steps it does not run (D-CE3) — only the ones the catalogue marks hideable, derived
 *     from `HIDEABLE_HIRING_STEPS`, never a list typed here. The six federal checks are shown locked.
 *
 * ⚠ No "change what proves it". 0545 refuses it (CS011): every record on the step was made under that
 * proof. Removing RETIRES the step (CS010): it leaves every checklist and stops holding any hire, and
 * what was recorded on it stays on the applicants' records.
 *
 * Writes on `session.can("recruitment")`, what the api's POST, PATCH and the settings PUT ask (Q-CE3).
 */
const session = useSessionStore();
const toast = useToastStore();
const ask = useConfirm();
const canManage = computed(() => session.can("recruitment"));
const stepsQ = useCarrierSteps();
const settingsQ = useRecruitingSettings();
const add = useAddCarrierStep();
const update = useUpdateCarrierStep();
const saveSettings = useSaveRecruitingSettings();

const ANCHOR_OPTIONS = CARRIER_STEP_ANCHORS.map((k) => ({ value: k, label: `After “${hiringStep(k).label}”` }));
const PROOF_OPTIONS = CARRIER_STEP_PROOFS.map((p) => ({ value: p, label: CARRIER_STEP_PROOF_LABELS[p] }));
const OWES_OPTIONS = [
  { value: "us", label: "The office does it" },
  { value: "them", label: "The applicant does it (we record it)" },
];
const LOCKED = HIRE_REFUSES_WITHOUT.map((k) => hiringStep(k).label);
const HIDEABLE = HIDEABLE_HIRING_STEPS.map((k) => ({ key: k, label: hiringStep(k).label }));

const blank = () => ({ label: "", instructions: "", afterStep: "road_test" as HiringStepKey, owes: "us" as "us" | "them", proof: "tick" as CarrierStepProof, blocksHire: false });
const form = reactive(blank());
const parsed = computed(() => carrierStepCreateSchema.safeParse({ ...form }));
const labelError = computed(() =>
  form.label !== "" && !parsed.value.success ? parsed.value.error.issues.find((i) => i.path[0] === "label")?.message : undefined,
);

const placeLabel = (s: CarrierStep) => {
  const anchor = CARRIER_STEP_ANCHORS.find((k) => k === s.after_step);
  return anchor ? `After “${hiringStep(anchor).label}”` : "Before the hire";
};

async function submit(): Promise<void> {
  if (!parsed.value.success) return;
  try {
    await add.mutateAsync(parsed.value.data);
    Object.assign(form, blank());
    toast.success("Step added", "It shows on every applicant's checklist.");
  } catch (e) {
    toast.error("Could not add the step", e instanceof Error ? e.message : undefined);
  }
}

async function setBlocks(step: CarrierStep, blocksHire: boolean): Promise<void> {
  try {
    await update.mutateAsync({ id: step.id, patch: { blocksHire } });
  } catch (e) {
    toast.error("Could not change the step", e instanceof Error ? e.message : undefined);
  }
}

async function remove(step: CarrierStep): Promise<void> {
  const yes = await ask({
    title: `Remove “${step.label}”?`,
    message: "It leaves every applicant's checklist and no hire waits for it. What was already recorded stays on their records.",
    confirmLabel: "Remove",
    tone: "danger",
  });
  if (!yes) return;
  try {
    await update.mutateAsync({ id: step.id, patch: { retire: true } });
    toast.success("Step removed");
  } catch (e) {
    toast.error("Could not remove the step", e instanceof Error ? e.message : undefined);
  }
}

const hidden = computed(() => new Set<string>(settingsQ.data.value?.settings.hidden_hiring_steps ?? []));
async function setRuns(key: HiringStepKey, runs: boolean): Promise<void> {
  const s = settingsQ.data.value?.settings;
  if (!s) return;
  const next = new Set(hidden.value);
  if (runs) next.delete(key);
  else next.add(key);
  try {
    await saveSettings.mutateAsync({ ...s, hidden_hiring_steps: HIDEABLE_HIRING_STEPS.filter((k) => next.has(k)) });
  } catch (e) {
    toast.error("Could not save the change", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-6" data-testid="carrier-steps-editor">
    <QueryState
      :loading="stepsQ.isLoading.value || settingsQ.isLoading.value"
      :error="stepsQ.isError.value ? stepsQ.error.value : settingsQ.isError.value ? settingsQ.error.value : null"
      error-text="Could not load your hiring steps."
      :retrying="stepsQ.isFetching.value || settingsQ.isFetching.value"
      loading-text="Loading your hiring steps…"
      compact
      @retry="stepsQ.refetch(); settingsQ.refetch()"
    >
      <div class="space-y-2">
        <h3 class="text-sm font-semibold text-ink">Your own steps</h3>
        <p v-if="(stepsQ.data.value ?? []).length === 0" class="text-xs text-ink-secondary" data-testid="no-steps">
          No steps of your own yet. Add one for anything your hiring needs that is not on the checklist — a hair test, a fuel card, a tablet.
        </p>
        <ul v-else class="divide-y divide-edge">
          <li v-for="step in stepsQ.data.value" :key="step.id" class="flex items-start justify-between gap-4 py-2" data-testid="carrier-step">
            <div class="min-w-0">
              <p class="text-sm font-medium text-ink">{{ step.label }}</p>
              <p class="text-xs text-ink-muted">
                {{ placeLabel(step) }} · {{ CARRIER_STEP_PROOF_LABELS[step.proof] }} · {{ step.blocks_hire ? "Hire waits for it" : "Does not hold the hire" }}
              </p>
            </div>
            <div v-if="canManage" class="flex shrink-0 items-center gap-3">
              <AppCheckbox
                :model-value="step.blocks_hire"
                label="Hire waits for it"
                :disabled="update.isPending.value"
                @update:model-value="(v: boolean) => setBlocks(step, v)"
              />
              <BaseButton size="sm" variant="ghost" :disabled="update.isPending.value" @click="remove(step)">Remove</BaseButton>
            </div>
          </li>
        </ul>
      </div>

      <div v-if="canManage" class="space-y-3 border-t border-edge pt-4" data-testid="add-step">
        <h3 class="text-sm font-semibold text-ink">Add a step</h3>
        <FormField v-slot="{ id }" label="Name" :error="labelError">
          <BaseInput :id="id" v-model="form.label" placeholder="Hair test" />
        </FormField>
        <FormField v-slot="{ id }" label="What to do" hint="Optional. Shown on the step for whoever does it.">
          <AppTextarea :id="id" v-model="form.instructions" :rows="2" />
        </FormField>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField v-slot="{ id }" label="Where it goes">
            <AppSelect :id="id" v-model="form.afterStep" :options="ANCHOR_OPTIONS" />
          </FormField>
          <FormField v-slot="{ id }" label="Who does it">
            <AppSelect :id="id" v-model="form.owes" :options="OWES_OPTIONS" />
          </FormField>
          <FormField v-slot="{ id }" label="What proves it" hint="Fixed once the step is added.">
            <AppSelect :id="id" v-model="form.proof" :options="PROOF_OPTIONS" />
          </FormField>
        </div>
        <AppCheckbox v-model="form.blocksHire" label="Hire waits for it" />
        <BaseButton variant="primary" size="sm" :disabled="!parsed.success || add.isPending.value" @click="submit">
          {{ add.isPending.value ? "Adding…" : "Add the step" }}
        </BaseButton>
      </div>

      <div class="space-y-2 border-t border-edge pt-4" data-testid="built-in-steps">
        <h3 class="text-sm font-semibold text-ink">Built-in steps you run</h3>
        <p class="text-xs text-ink-secondary">
          Untick a step your company does not use and it leaves the checklist. Always on, because the law requires them: {{ LOCKED.join(", ") }}.
        </p>
        <ul class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <li v-for="s in HIDEABLE" :key="s.key">
            <AppCheckbox
              :model-value="!hidden.has(s.key)"
              :label="s.label"
              :disabled="!canManage || saveSettings.isPending.value"
              @update:model-value="(v: boolean) => setRuns(s.key, v)"
            />
          </li>
        </ul>
      </div>
    </QueryState>
  </div>
</template>
