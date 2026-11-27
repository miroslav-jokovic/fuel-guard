<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { AppButton as BaseButton, AppCallout, AppInput, QueryState } from "@silvicom/ui";
import { TWO_STEP_CODE_LENGTH, TWO_STEP_DAYS, formatDisplayDateTime, twoStepSendSchema } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { useSessionStore } from "@/stores/session";

/**
 * Two-step sign-in, revision 2 (INSTALLED-APP-PLAN IA-S1; the owner's ruling of 2026-11-27, Q-IA20): a 6-digit code
 * emailed to the person's sign-in address, after which this browser is not asked again for a week.
 *
 * The router holds a device that owes its code on this page and nowhere else (`session.secondFactor`, the API's
 * 403). Opening it SENDS the code — there is nothing to choose first — and the API mails nothing new if a code
 * went out in the last minute, so a reload does not fill the inbox. Nothing to set up, nothing to turn off, no lost
 * phone: revision 1's authenticator app, its QR code and its recovery acts are gone with it.
 */
const session = useSessionStore();
const router = useRouter();

type Mode = "sending" | "enter" | "done";
const mode = ref<Mode>("sending");
const code = ref("");
const error = ref<string | null>(null);
/** Sending failed: its own state with a Retry, never a code box with nothing behind it. */
const sendError = ref<{ message: string } | null>(null);
const notice = ref<string | null>(null);
const busy = ref(false);

const status = computed(() => session.secondFactor);
const owed = computed(() => status.value?.required === true && status.value.satisfied === false);
const where = computed(() => status.value?.email_hint ?? "your email address");
const trustedUntil = computed(() => {
  const iso = status.value?.trusted_until;
  return iso ? formatDisplayDateTime(iso) : null;
});

async function send(again = false) {
  sendError.value = null;
  error.value = null;
  notice.value = null;
  if (!again) mode.value = "sending";
  const res = await apiFetch<unknown>("/api/me/second-factor/code", { method: "POST" });
  const parsed = res.ok ? twoStepSendSchema.safeParse(res.data) : null;
  if (!parsed?.success) {
    if (again) error.value = res.error?.message ?? "Could not send a new code. Try again.";
    else sendError.value = { message: res.error?.message ?? "Could not send your sign-in code." };
    return;
  }
  mode.value = "enter";
  code.value = "";
  if (again) {
    notice.value =
      parsed.data.outcome === "recent"
        ? "A code was sent less than a minute ago. Check your inbox and spam folder for it."
        : `A new code is on its way to ${where.value}.`;
  }
}

onMounted(() => {
  if (owed.value) void send();
  else mode.value = "done";
});

async function verify() {
  error.value = null;
  busy.value = true;
  try {
    const res = await apiFetch<unknown>("/api/me/second-factor/verify", { method: "POST", body: { code: code.value } });
    if (!res.ok) {
      error.value = res.error?.message ?? "That code was not accepted.";
      return;
    }
    await session.loadSurfaces();
    await router.push({ name: "dashboard" });
  } finally {
    busy.value = false;
  }
}

async function signOut() {
  await session.signOut();
  await router.push("/login");
}
</script>

<template>
  <div>
    <h2 class="text-lg font-semibold text-ink">Check your email</h2>
    <p class="mt-1 text-sm text-ink-muted" data-testid="two-step-lead">
      <template v-if="mode === 'done'">
        This browser has its sign-in code<template v-if="trustedUntil"> until {{ trustedUntil }}</template>.
      </template>
      <template v-else>
        We sent a {{ TWO_STEP_CODE_LENGTH }}-digit sign-in code to <strong class="text-ink-secondary">{{ where }}</strong>. Enter it
        below. This browser won't ask again for {{ TWO_STEP_DAYS }} days.
      </template>
    </p>

    <!-- ui-adoption: server-message — the API's sentence says WHICH send failed and what to do: five codes this
         hour (wait), no email on the account (ask an admin), the mail provider refused (try in a minute). -->
    <QueryState
      class="mt-5"
      compact
      :loading="mode === 'sending' && !sendError"
      :error="sendError"
      :error-text="sendError?.message ?? 'Could not send your sign-in code.'"
      loading-text="Sending your code…"
      @retry="send()"
    >
      <form v-if="mode === 'enter'" class="mt-4 space-y-4" @submit.prevent="verify">
        <AppInput
          v-model="code"
          aria-label="6-digit code"
          inputmode="numeric"
          autocomplete="one-time-code"
          placeholder="123456"
          :maxlength="TWO_STEP_CODE_LENGTH + 2"
          required
        />
        <AppCallout v-if="error" tone="danger" role="alert">{{ error }}</AppCallout>
        <AppCallout v-else-if="notice" tone="info" role="status">{{ notice }}</AppCallout>
        <BaseButton type="submit" variant="primary" block :disabled="busy">{{ busy ? "Checking…" : "Continue" }}</BaseButton>
        <p class="text-xs text-ink-muted">
          No email? It can take a minute — check spam too.
          <BaseButton variant="link" class="text-xs" data-testid="two-step-resend" :disabled="busy" @click="send(true)">Send a new code</BaseButton>
        </p>
      </form>
    </QueryState>

    <div class="mt-6 flex items-center justify-between text-sm">
      <BaseButton v-if="!owed" variant="link" @click="router.push({ name: 'dashboard' })">Back</BaseButton>
      <span v-else />
      <BaseButton variant="link" @click="signOut">Sign out</BaseButton>
    </div>
  </div>
</template>
