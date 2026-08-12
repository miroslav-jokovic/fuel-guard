<script setup lang="ts">
import { ref } from "vue";
import { AppButton as BaseButton } from "@fuelguard/ui";
import { AppInput as BaseInput } from "@fuelguard/ui";
import { AppFormField as FormField } from "@fuelguard/ui";
import { verifyStepUp } from "@/lib/stepUp";

/**
 * "Confirm your password to continue" — the browser half of step-up re-authentication.
 *
 * ── How this actually proves anything (audit P0-4) ───────────────────────────────────────────────
 * The password is sent to the API's POST /api/auth/step-up, which re-verifies it against Supabase's
 * own password grant and, ONLY then, mints a short-lived step-up token bound to this user. The token
 * is held in memory by `lib/stepUp.ts` and rides the next sensitive request in the `x-step-up-token`
 * header. This replaced reading the access token's `iat`, which the refresh-token grant re-mints
 * with no password — so a signed-in but unattended browser could pass it. Possession of a token that
 * only a typed password can mint cannot be manufactured that way.
 *
 * ── The honest caveat ────────────────────────────────────────────────────────────────────────────
 * An SSO-only account has no password to re-enter; there the server cannot mint a token and this
 * fails closed, which is why every surface that needs step-up is ALSO behind an admin role or a
 * named approver scope. Stated here rather than discovered later.
 *
 * The password is never stored, never emitted, and the field is cleared on every outcome.
 */

const props = defineProps<{ reason: string }>();
const emit = defineEmits<{ confirmed: []; cancel: [] }>();

const password = ref("");
const error = ref<string | null>(null);
const busy = ref(false);

async function confirm(): Promise<void> {
  busy.value = true;
  error.value = null;
  const ok = await verifyStepUp(password.value);
  password.value = "";
  busy.value = false;
  if (!ok) {
    // Deliberately not "wrong password": the same message covers a wrong password and an SSO account
    // with none, and neither case should be told anything about the other.
    error.value = "That did not work. Check your password and try again.";
    return;
  }
  emit("confirmed");
}
</script>

<template>
  <div class="flex min-h-[26rem] flex-col justify-center">
    <h3 class="text-base font-semibold text-ink">Confirm it is you</h3>
    <p class="mt-2 text-sm leading-6 text-ink-muted">{{ props.reason }}</p>
    <p class="mt-1 text-sm text-ink-tertiary">
      Enter your password to continue. This is asked for actions that cannot be undone by clicking again.
    </p>

    <form class="mt-4 space-y-4" @submit.prevent="confirm">
      <FormField label="Password" required :error="error ?? undefined">
        <template #default="{ id }">
          <BaseInput
            :id="id"
            v-model="password"
            type="password"
            autocomplete="current-password"
            :disabled="busy"
            :invalid="!!error"
          />
        </template>
      </FormField>
      <div class="flex justify-end gap-3">
        <BaseButton type="button" :disabled="busy" @click="emit('cancel')">Cancel</BaseButton>
        <BaseButton type="submit" variant="primary" :disabled="busy || password.length === 0">
          {{ busy ? "Checking…" : "Confirm" }}
        </BaseButton>
      </div>
    </form>
  </div>
</template>
