<script setup lang="ts">
import { computed, ref } from "vue";
import {
  EMPLOYMENT_GAP_EXPLANATION_MAX,
  formatDisplayDate,
  rangesOverlap,
  type EmploymentGapsView,
  type RecordedEmploymentGap,
} from "@silvicom/shared";
import { AppButton as BaseButton, AppFormField as FormField, AppTextarea, useConfirm } from "@silvicom/ui";
import { useToastStore } from "@/stores/toast";
import { useRecordEmploymentGap, useWithdrawEmploymentGap } from "@/features/recruitment/useEmploymentGaps";

/**
 * One gap on the driver record's timeline, and what explains it (HW5c, EM-7: "a gap found on a call
 * can't be recorded"). Two sources, shown side by side and never merged (`employmentGapContract.ts`):
 * what the applicant wrote in the signed application, and what the office recorded after signing —
 * "Added by {name} on {date}, after signing", withdrawable, never edited.
 *
 * A source explains this gap when its dates overlap it (`rangesOverlap`): the dates the driver gives
 * on the phone need not match the computed gap to the day. "Explain this gap" records it with the
 * gap's own dates. Without the recruitment manage grant the box shows the explanations and no form.
 */
const props = defineProps<{
  driverId: string;
  gap: { from: string; to: string };
  view: EmploymentGapsView | null;
  canEdit: boolean;
}>();

const toast = useToastStore();
const ask = useConfirm();
const record = useRecordEmploymentGap();
const withdraw = useWithdrawEmploymentGap();

const applicantSaid = computed(() => (props.view?.applicant ?? []).filter((g) => rangesOverlap(g, props.gap)));
const recorded = computed(() =>
  (props.view?.recorded ?? []).filter((g) => rangesOverlap({ from: g.startedOn, to: g.endedOn }, props.gap)),
);
const explained = computed(
  () => applicantSaid.value.length > 0 || recorded.value.some((g) => g.withdrawnAt === null),
);

const open = ref(false);
const text = ref("");

async function save(): Promise<void> {
  const explanation = text.value.trim();
  if (!explanation) return;
  try {
    await record.mutateAsync({
      driverId: props.driverId,
      gap: { started_on: props.gap.from, ended_on: props.gap.to, explanation },
    });
    toast.success("Gap recorded", "It shows on the record as added after signing.");
    open.value = false;
    text.value = "";
  } catch (e) {
    toast.error("Could not record the gap", e instanceof Error ? e.message : undefined);
  }
}

async function pull(g: RecordedEmploymentGap): Promise<void> {
  const yes = await ask({
    title: "Withdraw this explanation?",
    message: "It stays on the record, struck through, so the record shows it was given and then withdrawn.",
    confirmLabel: "Withdraw",
    tone: "danger",
  });
  if (!yes) return;
  try {
    await withdraw.mutateAsync({ driverId: props.driverId, gapId: g.id });
    toast.success("Explanation withdrawn");
  } catch (e) {
    toast.error("Could not withdraw it", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-2 text-sm" data-record-gap>
    <p v-for="(g, i) in applicantSaid" :key="`app-${i}`" class="text-ink-secondary" data-gap-applicant>
      The applicant said: {{ g.explanation }}
    </p>
    <div v-for="g in recorded" :key="g.id" class="space-y-0.5" data-gap-recorded>
      <p :class="g.withdrawnAt ? 'text-ink-muted line-through' : 'text-ink-secondary'">{{ g.explanation }}</p>
      <p class="text-xs text-ink-muted">
        Added by {{ g.recordedByName }} on {{ formatDisplayDate(g.createdAt.slice(0, 10)) }}, after signing<template v-if="g.withdrawnAt">
          · withdrawn {{ formatDisplayDate(g.withdrawnAt.slice(0, 10)) }}</template>
        <BaseButton
          v-if="canEdit && !g.withdrawnAt"
          variant="link"
          size="sm"
          class="ml-2"
          :disabled="withdraw.isPending.value"
          @click="pull(g)"
        >
          Withdraw
        </BaseButton>
      </p>
    </div>
    <p v-if="!explained" class="text-xs text-ink-muted">Not explained yet.</p>
    <template v-if="canEdit">
      <BaseButton v-if="!open" size="sm" variant="secondary" @click="open = true">
        {{ explained ? "Add another explanation" : "Explain this gap" }}
      </BaseButton>
      <div v-else class="space-y-2">
        <FormField v-slot="{ id }" label="What were they doing?" :hint="`In their words. ${formatDisplayDate(gap.from)} – ${formatDisplayDate(gap.to)}.`">
          <AppTextarea :id="id" v-model="text" :rows="2" :maxlength="EMPLOYMENT_GAP_EXPLANATION_MAX" />
        </FormField>
        <div class="flex gap-2">
          <BaseButton size="sm" variant="primary" :disabled="!text.trim() || record.isPending.value" @click="save">
            Record it
          </BaseButton>
          <BaseButton size="sm" variant="ghost" @click="open = false">Cancel</BaseButton>
        </div>
      </div>
    </template>
  </div>
</template>
