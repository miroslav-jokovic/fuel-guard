<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { purgeNameMatches } from "@silvicom/shared";
import { AppButton as BaseButton, AppInput as BaseInput, AppFormField as FormField } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import StepUpPrompt from "@/components/StepUpPrompt.vue";
import { useStepUpRetry } from "@/composables/useStepUpRetry";
import { useToastStore } from "@/stores/toast";
import { useApplicantPurge } from "./useApplicantPurge";

/**
 * "Delete permanently…" on the Recruitment board's Archived view (Q-AW40, P2).
 *
 * A drawer, on MemberPasswordResetDrawer's reasoning: it can say what the act DOES before it happens.
 * Here that matters more than anywhere — archiving is the reversible step the admin has already
 * taken, and this one removes the person, everything they filled in and signed, and their files, for
 * good. The name is typed (`purgeNameMatches`, the rule the api checks again) so the admin reads
 * WHICH person; the api then asks for their password (`requireFreshAuth`), which replaces this body
 * and re-runs the delete once given.
 *
 * What it cannot do is said on screen rather than discovered: 0380 refuses anybody who was ever hired
 * (their qualification file is kept by law), and the refusal's own sentence is what the toast shows.
 */
const props = defineProps<{ applicant: { driver_id: string; full_name: string } | null }>();
const emit = defineEmits<{ close: [] }>();

const toast = useToastStore();
const purge = useApplicantPurge();
const { stepUpFor, holdForStepUp, confirmed, cancel } = useStepUpRetry();
const typed = ref("");
watch(
  () => props.applicant?.driver_id,
  () => (typed.value = ""),
);
const matches = computed(() => purgeNameMatches(typed.value, props.applicant?.full_name));

async function run(): Promise<void> {
  const a = props.applicant;
  if (!a) return;
  try {
    const result = await purge.mutateAsync({ driverId: a.driver_id, confirmName: typed.value });
    if (!result.audited || result.storageNotRemoved.length > 0) {
      toast.error(
        "Deleted, with something left over",
        [
          result.storageNotRemoved.length > 0
            ? `${result.storageNotRemoved.length} file(s) could not be removed and are named in the log.`
            : null,
          result.audited ? null : "The audit entry could not be written.",
        ]
          .filter(Boolean)
          .join(" "),
      );
    } else {
      toast.success("Deleted", `${a.full_name} and everything from their application are gone.`);
    }
    emit("close");
  } catch (e) {
    if (holdForStepUp(e, run)) return;
    toast.error("Could not delete", e instanceof Error ? e.message : undefined);
  }
}

function close(): void {
  cancel();
  emit("close");
}
</script>

<template>
  <SlideOver :open="applicant !== null" title="Delete permanently" :description="applicant?.full_name" @close="close">
    <StepUpPrompt v-if="stepUpFor" :reason="stepUpFor" @confirmed="confirmed" @cancel="cancel" />
    <div v-else class="space-y-4 text-sm text-ink-secondary">
      <p>
        This removes {{ applicant?.full_name }} and everything from their application — what they filled in, what they
        signed, their photos and filed PDFs. It can't be undone, and unlike archiving there is no way to bring them back.
      </p>
      <p>Somebody who was hired can't be deleted: their qualification file is kept by law.</p>
      <FormField v-slot="{ id }" label="Type their name to confirm" :hint="`Type ${applicant?.full_name ?? ''}`">
        <BaseInput :id="id" v-model="typed" autocomplete="off" />
      </FormField>
    </div>
    <template #footer>
      <div class="flex items-center justify-end gap-3">
        <BaseButton :disabled="purge.isPending.value" @click="close">Cancel</BaseButton>
        <BaseButton
          variant="danger"
          :disabled="!matches || purge.isPending.value || stepUpFor !== null"
          @click="run"
        >
          {{ purge.isPending.value ? "Deleting…" : "Delete permanently" }}
        </BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
