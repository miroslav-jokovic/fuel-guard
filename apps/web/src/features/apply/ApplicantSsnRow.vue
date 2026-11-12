<script setup lang="ts">
import { computed, ref, toRef } from "vue";
import { AppButton as BaseButton, AppInput as BaseInput } from "@silvicom/ui";
import { applicantSsnSchema, formatSsn, FULL_SSN_PERMISSION, maskSsn } from "@silvicom/shared";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { revealApplicantSsn, useReplaceApplicantSsn } from "./useApplicationReview";
import { APPLY_COPY } from "./strings";

/**
 * The SSN on the office's "Applicant facts" card (Q-AM3/Q-AM17, owner 2026-11-11; 0589).
 *
 * ── WHY ITS OWN ROW, NOT A CATALOGUE ROW ──────────────────────────────────────────────────────
 * Every other fact is shown as stored and corrected in place. This one is shown as its last four to
 * everyone (`•••-••-1234`), read whole only by a holder of "See the full SSN" — the safety manager and the
 * admin by default — and REPLACED by anybody who corrects the application, recruiters included, who type
 * a new number without ever seeing the old one. The catalogue names its door (`office: "ssn"`); this is it.
 *
 * ⚠ The whole number is fetched per press and held only while it is shown: a plain request, never a
 * query, so nothing keeps it after "Hide" or after the drawer closes. Every read is audited by the API.
 */
const props = defineProps<{
  invitationId: string;
  /** The review's `ssn`: the last four held before signing, or null. */
  last4: string | null;
  /** The record's correction window (`recordOpen`): open until the driver's first packet mark. */
  open: boolean;
}>();

const label = APPLY_COPY.identity.ssn;
const session = useSessionStore();
const toast = useToastStore();
const canReadWhole = computed(() => session.hasPermission(FULL_SSN_PERMISSION));
const replace = useReplaceApplicantSsn(toRef(props, "invitationId"));

const whole = ref<string | null>(null);
const reading = ref(false);
const editing = ref(false);
const typed = ref("");
const problem = ref<string | null>(null);

const masked = computed(() => (props.last4 ? maskSsn(props.last4) : "Not given"));
const shownWhole = computed(() => (whole.value ? formatSsn(whole.value) : null));

async function show(): Promise<void> {
  problem.value = null;
  reading.value = true;
  try {
    whole.value = await revealApplicantSsn(props.invitationId);
    // Kept as its last four only (no secret box on the deploy that took it): say so, rather than nothing.
    if (!whole.value) problem.value = "Only the last four digits were kept for this applicant.";
  } catch (e) {
    problem.value = e instanceof Error ? e.message : "The number could not be read.";
  } finally {
    reading.value = false;
  }
}

async function save(): Promise<void> {
  problem.value = null;
  const parsed = applicantSsnSchema.safeParse({ ssn: typed.value });
  if (!parsed.success) {
    problem.value = "A Social Security number is nine digits.";
    return;
  }
  try {
    await replace.mutateAsync(parsed.data.ssn);
    toast.push("success", "Social Security number replaced", "The applicant is shown that it changed before they sign.");
    [typed.value, editing.value, whole.value] = ["", false, null];
  } catch (e) {
    problem.value = e instanceof Error ? e.message : "That number could not be saved.";
  }
}
</script>

<template>
  <div class="py-2" data-fact="ssn">
    <div v-if="!editing" class="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
      <span class="min-w-0 text-sm text-ink-muted sm:w-56 sm:shrink-0">{{ label }}</span>
      <span class="min-w-0 flex-1 text-sm" :class="last4 ? 'text-ink' : 'text-ink-tertiary'" data-ssn-value>
        {{ shownWhole ?? masked }}
      </span>
      <BaseButton v-if="canReadWhole && last4 && !whole" size="sm" variant="ghost" :disabled="reading" @click="show">Show</BaseButton>
      <BaseButton v-if="whole" size="sm" variant="ghost" @click="whole = null">Hide</BaseButton>
      <BaseButton v-if="open" size="sm" variant="ghost" @click="editing = true">{{ last4 ? "Replace" : "Add" }}</BaseButton>
    </div>
    <div v-else class="space-y-2">
      <label for="office-ssn" class="block text-sm text-ink-muted">New {{ label }}</label>
      <BaseInput id="office-ssn" v-model="typed" inputmode="numeric" autocomplete="off" />
      <div class="flex gap-2">
        <BaseButton size="sm" :disabled="replace.isPending.value" @click="save">Save</BaseButton>
        <BaseButton size="sm" variant="ghost" @click="[editing, typed, problem] = [false, '', null]">Cancel</BaseButton>
      </div>
    </div>
    <p v-if="problem" class="mt-1 text-sm text-danger-700" role="alert">{{ problem }}</p>
  </div>
</template>
