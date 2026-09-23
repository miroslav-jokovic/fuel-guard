<script setup lang="ts">
import { ref } from "vue";
import { PASSWORD_RESET_TTL_MINUTES } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { AppFormField as FormField } from "@silvicom/ui";
import { AppInput as BaseInput } from "@silvicom/ui";
import { AppButton as BaseButton } from "@silvicom/ui";

/**
 * "Forgot password?" — ask for a reset link (0363, PASSWORD-RESET-PLAN.md).
 *
 * The page says the SAME thing whatever the address is, because the API does: whether it has an
 * account, belongs to a driver, or has asked three times this hour is not something an anonymous
 * visitor gets to learn. That is why the confirmation is phrased "if that address has an account" —
 * it is the honest sentence, not a hedge. A network failure is the one different answer, because
 * then nothing was asked at all and trying again is the right advice.
 *
 * Drivers are told where their reset lives instead: their login is a username, not an address, and
 * it is reset by the office (DRIVER-CREDENTIALS-PLAN DC3).
 */
const email = ref("");
const loading = ref(false);
const done = ref(false);
const error = ref<string | null>(null);

async function onSubmit() {
  error.value = null;
  loading.value = true;
  try {
    const res = await apiFetch("/api/public/password-reset/request", {
      method: "POST",
      body: { email: email.value.trim() },
    });
    if (res.ok) done.value = true;
    else if (res.status === 429) error.value = "Too many requests from here. Wait a few minutes and try again.";
    else if (res.status === 400) error.value = "Enter the email address you sign in with.";
    else error.value = "Could not send the request. Try again in a moment.";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div>
    <template v-if="done">
      <h2 class="mb-1 text-lg font-semibold text-ink">Check your email</h2>
      <p class="text-sm text-ink-muted">
        If <span class="font-medium text-ink">{{ email.trim() }}</span> has a Silvicom 360 account, a link to choose
        a new password is on its way. It works once, for {{ PASSWORD_RESET_TTL_MINUTES }} minutes.
      </p>
      <p class="mt-3 text-sm text-ink-muted">Nothing after a few minutes? Check spam, or ask your administrator to send one.</p>
    </template>

    <template v-else>
      <h2 class="mb-1 text-lg font-semibold text-ink">Reset your password</h2>
      <p class="mb-6 text-sm text-ink-muted">Enter the email you sign in with and we'll send you a link to choose a new password.</p>

      <form class="space-y-5" @submit.prevent="onSubmit">
        <FormField id="email" v-slot="{ id }" label="Email">
          <BaseInput :id="id" v-model="email" type="email" autocomplete="email" required />
        </FormField>

        <p v-if="error" class="text-sm text-danger-600">{{ error }}</p>

        <BaseButton type="submit" variant="primary" block :disabled="loading || email.trim().length === 0">
          {{ loading ? "Sending…" : "Send reset link" }}
        </BaseButton>
      </form>

      <p class="mt-6 text-center text-sm text-ink-muted">
        Driver? Your login is reset by your dispatch office, not by email.
      </p>
    </template>

    <RouterLink to="/login" class="mt-6 inline-block text-sm text-brand-700 underline">Back to sign in</RouterLink>
  </div>
</template>
