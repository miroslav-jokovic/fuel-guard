<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AppButton as BaseButton, AppCallout, AppFormField as FormField, AppInput as BaseInput } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { useToastStore } from "@/stores/toast";
import { useDeleteInspectionRecord } from "@/features/maintenance/useAnnualInspections";

/**
 * Destroying a §396.17 report, and everything it created (D-AVI29).
 *
 * ── WHY THIS IS A DRAWER AND NOT A `window.confirm` ────────────────────────────────────────────
 * Discarding a draft uses `window.confirm`, and that is right for it: nothing has been certified and
 * nothing is filed. This is a different act — the report, its 56 components, the certification, the
 * filed PDF and the object in storage all go, and the equipment's inspection date goes back to what the
 * remaining reports justify. A dialog with an OK button cannot carry that list, cannot take a
 * reason, and cannot make somebody slow down.
 *
 * ── THE UNIT NUMBER IS TYPED, AND THE PREDICATE IS ONE COMPUTED ────────────────────────────────
 * `fuelCards/TypeToConfirm.vue` exists but is four-digits-only by design — its own header explains
 * why it never sees anything but a masked card's last four — so it is not reusable here, and
 * generalising it would blur the component that comment is protecting. What IS reused is its lesson:
 * ONE predicate drives both the mismatch hint and the disabled button, because two copies of "have
 * they typed the right thing" is how a Confirm button enables while the field still shows an error.
 *
 * ── THE REASON IS NOT DECORATION ───────────────────────────────────────────────────────────────
 * It goes into the audit row, which outlives everything else here — `audit_logs` is in
 * `RETENTION_FORBIDDEN`. After this runs, that sentence is the only remaining answer to "what was
 * this record and why is it gone", so the server refuses a blank one and so does this form.
 */

const props = defineProps<{
  open: boolean;
  inspectionId: string;
  /** What has to be typed back: the unit the report is about, as the office knows it. */
  unitNumber: string;
  /**
   * Tractor or trailer — the copy says which.
   *
   * Deleting a TRAILER's report used to announce that "the truck no longer carries an annual
   * inspection date" (reported 2026-09-01). §396.17 covers both, one form covers both (D-AVI12), and
   * a fleet of 198 tractors and 211 trailers has more of the thing the sentence called a truck.
   */
  subjectType: "tractor" | "trailer";
  status: "draft" | "final";
}>();
const emit = defineEmits<{ close: []; deleted: [] }>();

const toast = useToastStore();
const remove = useDeleteInspectionRecord();

const reason = ref("");
const typed = ref("");

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reason.value = "";
    typed.value = "";
  },
);

/**
 * With no unit number there is nothing to type back, and the field becomes UNSATISFIABLE — which is
 * exactly what shipped on 2026-09-01: the detail route did not resolve `unit_number`, the drawer got
 * an empty string, and the office typed the truck number over and over against a comparison that
 * could never be true. The data bug is fixed at the source; this makes the failure LOUD instead of
 * silent if it ever returns, because a confirmation nobody can satisfy is worse than no
 * confirmation.
 */
/** The word for the thing being inspected, so the copy is not written for half the fleet. */
const noun = computed(() => (props.subjectType === "trailer" ? "trailer" : "truck"));

const expected = computed(() => props.unitNumber.trim());
const cannotConfirm = computed(() => expected.value.length === 0);

/** Trimmed on both sides: a trailing space is a typo, not a refusal to confirm. */
const matches = computed(() => !cannotConfirm.value && typed.value.trim() === expected.value);
const showMismatch = computed(() => typed.value.length > 0 && !matches.value);
/** The same rule the server applies, so the button and the API agree about what a reason is. */
const reasonOk = computed(() => reason.value.trim().length >= 3);
const blocked = computed(() => !matches.value || !reasonOk.value || remove.isPending.value);

async function confirmDelete() {
  try {
    const result = await remove.mutateAsync({ id: props.inspectionId, reason: reason.value.trim() });
    toast.success(
      "Record deleted",
      result.expiresOn
        ? `This ${noun.value}'s inspection now expires ${result.expiresOn}, from the report that remains.`
        : `This ${noun.value} no longer carries an annual inspection date.`,
    );
    emit("deleted");
  } catch (e) {
    toast.error("Could not delete the record", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <SlideOver :open="open" size="lg" title="Delete this record" @close="emit('close')">
    <div class="space-y-6">
      <AppCallout tone="danger">
        <p class="font-semibold">This cannot be undone.</p>
        <p class="mt-1">
          The report, every component result on it, the certification and the filed PDF are all
          removed, and the file is deleted from storage. This {{ noun }}'s inspection date goes back
          to whatever its remaining reports justify.
        </p>
        <p v-if="status === 'final'" class="mt-2">
          This report was <strong>certified</strong>. §396.21(b) asks a carrier to keep it for
          fourteen months — delete it only when it should never have existed, not to fix something a
          correction would fix.
        </p>
      </AppCallout>

      <FormField
        v-slot="{ id }"
        label="Why is this being deleted?"
        hint="This sentence outlives the record. It is what the audit trail will show."
      >
        <BaseInput :id="id" v-model="reason" placeholder="e.g. created against the wrong unit" />
      </FormField>

      <AppCallout v-if="cannotConfirm" tone="danger">
        This report does not know which unit it is about, so there is nothing to type back and it
        cannot be confirmed here. That is a fault in the app, not in your data — report it.
      </AppCallout>

      <template v-else>
        <FormField
          v-slot="{ id }"
          :label="`Type ${expected} to confirm`"
          hint="The unit this report is about."
        >
          <BaseInput :id="id" v-model="typed" :invalid="showMismatch" autocomplete="off" />
        </FormField>
        <p v-if="showMismatch" class="-mt-4 text-sm text-danger-600" role="alert">
          That is not {{ expected }}.
        </p>
      </template>
    </div>

    <template #footer>
      <div class="flex items-center justify-end gap-3">
        <BaseButton variant="ghost" @click="emit('close')">Cancel</BaseButton>
        <BaseButton v-if="!cannotConfirm" variant="danger" :disabled="blocked" @click="confirmDelete">
          {{ remove.isPending.value ? "Deleting…" : "Delete this record" }}
        </BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
