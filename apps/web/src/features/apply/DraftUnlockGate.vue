<script setup lang="ts">
import { ref } from "vue";
import {
  AppButton as BaseButton,
  AppCard as BaseCard,
  AppDateField,
  AppFormField as FormField,
} from "@silvicom/ui";
import { unlockApplicationDraft } from "./useApplication";
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
 * Split out of `ApplyPage.vue` on 2026-09-11 (the 500-line budget), and it owns its own three flags
 * rather than reporting them upward — the page needs the payload, not the attempt.
 */
const props = defineProps<{ token: string; carrier: string }>();
const emit = defineEmits<{ unlocked: [payload: Record<string, unknown>] }>();

const dateOfBirth = ref("");
const failed = ref(false);
const working = ref(false);

async function unlock(): Promise<void> {
  if (!dateOfBirth.value) return;
  working.value = true;
  failed.value = false;
  try {
    const res = await unlockApplicationDraft(props.token, dateOfBirth.value);
    if (res.draft.locked || !res.draft.payload) failed.value = true;
    else emit("unlocked", res.draft.payload);
  } catch {
    failed.value = true;
  } finally {
    working.value = false;
  }
}
</script>

<template>
  <BaseCard>
    <h1 class="text-lg font-semibold text-ink">{{ APPLY_COPY.unlock.heading }}</h1>
    <p class="mt-2 text-sm text-ink-muted">{{ APPLY_COPY.unlock.body(carrier) }}</p>
    <div class="mt-4 max-w-xs">
      <FormField v-slot="{ id }" :label="APPLY_COPY.unlock.label">
        <AppDateField :id="id" v-model="dateOfBirth" />
      </FormField>
    </div>
    <p v-if="failed" class="mt-2 text-sm text-ink-secondary">{{ APPLY_COPY.unlock.failed }}</p>
    <div class="mt-6 flex justify-end">
      <BaseButton variant="primary" :disabled="working || !dateOfBirth" @click="unlock">
        {{ working ? APPLY_COPY.unlock.checking : APPLY_COPY.unlock.action }}
      </BaseButton>
    </div>
  </BaseCard>
</template>
