<script setup lang="ts">
import { ref } from "vue";
import { AppButton as BaseButton } from "@fuelguard/ui";
import { AppInput as BaseInput } from "@fuelguard/ui";
import { AppFormField as FormField } from "@fuelguard/ui";
import { supabase } from "@/lib/supabase";
import { useSessionStore } from "@/stores/session";

/**
 * "Confirm your password to continue" — the browser half of step-up re-authentication.
 *
 * ── How this actually proves anything ────────────────────────────────────────────────────────────
 * `signInWithPassword` mints a NEW access token, and the API's `requireFreshAuth` reads that token's
 * `iat`. So a successful sign-in here is what makes the very next request pass a freshness check
 * three hundred seconds wide. There is no separate step-up token, no server-side state, and nothing
 * the browser can assert on its own — the proof rides inside a signature the API verifies anyway.
 *
 * ── The honest caveat ────────────────────────────────────────────────────────────────────────────
 * An SSO-only account has no password to re-enter. There this degrades to "your session is recent"
 * rather than "you proved it was you", which is why every surface that requires step-up is ALSO
 * behind an admin role or a named approver scope. Stated here rather than discovered later.
 *
 * The password is never stored, never emitted, and the field is cleared on every outcome.
 */

const props = defineProps<{ reason: string }>();
const emit = defineEmits<{ confirmed: []; cancel: [] }>();

const session = useSessionStore();
const password = ref("");
const error = ref<string | null>(null);
const busy = ref(false);

async function confirm(): Promise<void> {
  const email = session.email;
  if (!email) {
    error.value = "We could not read your account email. Sign out and back in, then try again.";
    return;
  }
  busy.value = true;
  error.value = null;
  const { error: authError } = await supabase.auth.signInWithPassword({ email, password: password.value });
  password.value = "";
  busy.value = false;
  if (authError) {
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
