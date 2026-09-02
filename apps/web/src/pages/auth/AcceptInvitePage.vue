<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { hasSessionMaterial, inviteLinkErrorMessage, parseInviteUrl } from "@silvicom/shared";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";
import { useSessionStore } from "@/stores/session";
import { AppFormField as FormField } from "@silvicom/ui";
import { AppInput as BaseInput } from "@silvicom/ui";
import { AppButton as BaseButton } from "@silvicom/ui";

/**
 * Where an invited user sets their password and gets their membership.
 *
 * ── WHY THIS PAGE OWNS ITS OWN AUTH (2026-09-02) ────────────────────────────────────────────────
 * It used to be `requiresAuth: true` and do nothing but read `session.session`, trusting supabase-js
 * `detectSessionInUrl` to have already turned the URL into a session. That works for exactly one of
 * the four shapes an invite arrives in (the implicit-grant fragment), and for none of the ways one
 * can fail. Every other outcome — a spent link, an expired link, a `token_hash` needing `verifyOtp`
 * — left `isAuthenticated` false, and the router guard turns that into a redirect to /login. So the
 * reported symptom ("the invite link sends me to the login page") was every failure mode at once,
 * and the "Link expired" branch this file already had was unreachable: the guard ran first.
 *
 * The route is `public: true` now and the page resolves the link itself. That is not a loosening —
 * nothing here is readable without a session; the password form is behind a token this page
 * verifies, and `/api/invites/accept` re-checks email confirmation server-side regardless.
 */
const session = useSessionStore();
const router = useRouter();

type Step = "verifying" | "password" | "unusable";
const step = ref<Step>("verifying");
const linkError = ref<string | null>(null);

const password = ref("");
const confirm = ref("");
const error = ref<string | null>(null);
const loading = ref(false);

const RESEND_HINT = "Ask your administrator to resend the invitation.";

/**
 * Redeem whatever the link carried. Runs once, before anything is shown, so the user never sees a
 * password form they cannot submit.
 *
 * An EXISTING session wins over a missing token: supabase-js may already have consumed the fragment
 * on its way through `session.init()`, which leaves the URL bare but the user signed in. Treating
 * that as "not an invitation link" would lock out the exact case that used to work.
 */
async function resolveLink() {
  const params = parseInviteUrl(window.location.href);

  if (!params.errorDescription && !hasSessionMaterial(params) && session.session) {
    step.value = "password";
    return;
  }

  const preflight = inviteLinkErrorMessage(params);
  if (preflight) {
    linkError.value = preflight;
    step.value = "unusable";
    return;
  }

  try {
    if (params.accessToken && params.refreshToken) {
      const { error: e } = await supabase.auth.setSession({
        access_token: params.accessToken,
        refresh_token: params.refreshToken,
      });
      if (e) throw e;
    } else if (params.code) {
      const { error: e } = await supabase.auth.exchangeCodeForSession(params.code);
      if (e) throw e;
    } else if (params.verifyTokenHash) {
      const { error: e } = await supabase.auth.verifyOtp({
        type: (params.verifyType ?? "invite") as EmailOtpType,
        token_hash: params.verifyTokenHash,
      });
      if (e) throw e;
    }
  } catch {
    linkError.value = "This invitation link has expired or was already used.";
    step.value = "unusable";
    return;
  }

  /**
   * ADOPT the session the client now holds — do not rotate it.
   *
   * This block called `session.refresh()` until 2026-09-02 and locked a real user out. `refresh()`
   * is `refreshSession()`, which ROTATES a refresh token that `verifyOtp` had issued seconds
   * earlier; when that raced with supabase-js's own auto-refresh it failed, `refresh()` swallowed
   * the error, the store stayed null, and this branch told somebody their link had expired while
   * the server had already recorded their sign-in. Their password was never set and no membership
   * was ever created, because the page gave up before reaching either.
   *
   * The client is the authority on whether redemption worked, so ask IT, not a fresh round trip.
   */
  await session.syncFromClient();
  if (!session.session) {
    // Genuinely no session: redemption reported success but produced nothing to sign in with.
    // Distinct wording from the spent-link case above, because "try again" is the wrong advice for
    // a link that was already consumed and the right advice for this.
    linkError.value = "We couldn't sign you in from this link.";
    step.value = "unusable";
    return;
  }

  // Strip the credential out of the address bar before the user can bookmark or share it. `replace`
  // so Back does not walk into a URL whose token has since been spent.
  window.history.replaceState(window.history.state, "", window.location.pathname);
  step.value = "password";
}

onMounted(resolveLink);

const canSubmit = computed(() => !loading.value && password.value.length > 0);

async function onSubmit() {
  error.value = null;
  if (password.value.length < 8) {
    error.value = "Password must be at least 8 characters.";
    return;
  }
  if (password.value !== confirm.value) {
    error.value = "Passwords do not match.";
    return;
  }
  loading.value = true;
  try {
    const { error: pwErr } = await supabase.auth.updateUser({ password: password.value });
    if (pwErr) throw pwErr;

    const res = await apiFetch("/api/invites/accept", { method: "POST", body: {} });
    if (!res.ok) {
      throw new Error(res.error?.message ?? "Could not accept the invitation.");
    }

    await session.refresh(); // pick up org_id / user_role claims (audit B3)
    router.push("/");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Something went wrong.";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div>
    <template v-if="step === 'verifying'">
      <h2 class="mb-1 text-lg font-semibold text-ink">Checking your invitation…</h2>
      <p class="text-sm text-ink-muted">One moment.</p>
    </template>

    <template v-else-if="step === 'unusable'">
      <h2 class="mb-1 text-lg font-semibold text-ink">This link can't be used</h2>
      <p class="text-sm text-ink-muted">{{ linkError }}</p>
      <p class="mt-2 text-sm text-ink-muted">{{ RESEND_HINT }}</p>
      <RouterLink to="/login" class="mt-6 inline-block text-sm text-brand-700 underline">
        Back to sign in
      </RouterLink>
    </template>

    <template v-else>
      <h2 class="mb-1 text-lg font-semibold text-ink">Set your password</h2>
      <p class="mb-6 text-sm text-ink-muted">Finish setting up your Silvicom 360 account.</p>

      <form class="space-y-5" @submit.prevent="onSubmit">
        <FormField id="pw" v-slot="{ id }" label="New password">
          <BaseInput :id="id" v-model="password" type="password" autocomplete="new-password" required />
        </FormField>
        <FormField id="cf" v-slot="{ id }" label="Confirm password">
          <BaseInput :id="id" v-model="confirm" type="password" autocomplete="new-password" required />
        </FormField>

        <p v-if="error" class="text-sm text-danger-600">{{ error }}</p>

        <BaseButton type="submit" variant="primary" block :disabled="!canSubmit">
          {{ loading ? "Saving…" : "Set password & continue" }}
        </BaseButton>
      </form>
    </template>
  </div>
</template>
