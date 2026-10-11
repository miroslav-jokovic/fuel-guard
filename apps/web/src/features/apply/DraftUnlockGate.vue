<script setup lang="ts">
import { ref } from "vue";
import {
  AppButton as BaseButton,
  AppCard as BaseCard,
  AppDateField,
  AppFormField as FormField,
} from "@silvicom/ui";
import { unlockApplicationDraft, type Released } from "./useApplication";
import { APPLY_COPY } from "./strings";

/**
 * One question, before a saved application is read back to whoever is holding the link (A2, D-APP16).
 *
 * ⚠ The link alone is not enough once the draft contains a date of birth. An application link arrives
 * by email — forwarded, scanned by a mail gateway, opened on a phone somebody else is holding — and
 * the answers behind it are a date of birth, a licence number and an employment history. So the
 * server withholds the body and this asks for the one thing the applicant knows and a stranger with
 * the link does not.
 *
 * A wrong answer costs nothing but another try: there is no lockout, because the failure mode of a
 * lockout here is a driver who cannot reach their own application at 5am in a truck stop.
 *
 * ⚠ Except on a link the office SENT for signing (D-AW14, C3s3a): the driver is in the office, the link
 * travelled by text, and the date of birth is on the CDL they photographed — so the server counts, this
 * says how many tries are left, and the fifth wrong answer stops the link (410 `sign_link_locked`), after
 * which there is nothing to type and the screen says to ask for it again.
 *
 * Split out of `ApplyPage.vue` on 2026-09-11 (the 500-line budget), and it owns its own three flags
 * rather than reporting them upward — the page needs the payload, not the attempt.
 */
const props = defineProps<{ token: string; carrier: string }>();
const emit = defineEmits<{ unlocked: [released: Released] }>();

const dateOfBirth = ref("");
const failed = ref(false);
const working = ref(false);
/** Tries left on a sent sign link; null on every other link, which says nothing about tries. */
const attemptsLeft = ref<number | null>(null);
const stopped = ref(false);

async function unlock(): Promise<void> {
  if (!dateOfBirth.value) return;
  working.value = true;
  failed.value = false;
  try {
    const res = await unlockApplicationDraft(props.token, dateOfBirth.value);
    if (res.draft.locked) {
      failed.value = true;
      attemptsLeft.value = res.draft.attemptsLeft ?? null;
    } else emit("unlocked", { payload: res.draft.payload ?? {}, partOne: res.draft.partOne ?? null, revision: res.draft.revision });
  } catch (e) {
    if ((e as { code?: string }).code === "sign_link_locked") stopped.value = true;
    else failed.value = true;
  } finally {
    working.value = false;
  }
}
</script>

<template>
  <BaseCard v-if="stopped">
    <h1 class="text-lg font-semibold text-ink">{{ APPLY_COPY.unlock.heading }}</h1>
    <p class="mt-2 text-sm text-ink-muted" role="alert">{{ APPLY_COPY.unlock.lockedOut(carrier) }}</p>
  </BaseCard>
  <BaseCard v-else>
    <h1 class="text-lg font-semibold text-ink">{{ APPLY_COPY.unlock.heading }}</h1>
    <p class="mt-2 text-sm text-ink-muted">{{ APPLY_COPY.unlock.body(carrier) }}</p>
    <div class="mt-4 max-w-xs">
      <FormField v-slot="{ id }" :label="APPLY_COPY.unlock.label">
        <AppDateField :id="id" v-model="dateOfBirth" />
      </FormField>
    </div>
    <p v-if="failed" class="mt-2 text-sm text-ink-secondary" role="alert">
      {{ attemptsLeft === null ? APPLY_COPY.unlock.failed : APPLY_COPY.unlock.attemptsLeft(attemptsLeft) }}
    </p>
    <div class="mt-6 flex justify-end">
      <BaseButton variant="primary" :disabled="working || !dateOfBirth" @click="unlock">
        {{ working ? APPLY_COPY.unlock.checking : APPLY_COPY.unlock.action }}
      </BaseButton>
    </div>
  </BaseCard>
</template>
