<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import {
  hasSessionMaterial,
  inviteLinkErrorMessage,
  parseInviteUrl,
  type InviteLinkParams,
} from "@silvicom/shared";
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
 * ── WHY THE TOKEN IS REDEEMED ON SUBMIT AND NOT ON LOAD (2026-09-02) ────────────────────────────
 * Measured on production, three sends in a row:
 *
 *   invite sent 20:51:02 → email CONFIRMED 20:51:17   (15s)
 *   link  sent 14:26:09 → sign-in recorded 14:26:56   (47s)
 *   link  sent 15:14:27 → sign-in recorded 15:14:52   (25s)
 *
 * Nobody receives, opens and clicks an email in fifteen seconds. The recipient's mail security is
 * opening these links automatically — and it EXECUTES JAVASCRIPT, because `verifyOtp` only ever ran
 * from this page. So the scanner redeemed the one-time token, took a session it threw away, and the
 * human who clicked minutes later got "this link has expired". Every time, for two days.
 *
 * That is also why the earlier fix did not help. Moving off Supabase's `action_link` onto a
 * `token_hash` URL of our own removed the danger from a plain HTTP GET, which is what most scanners
 * do — but this one renders the page. A link that spends itself on RENDER cannot survive a scanner
 * that renders.
 *
 * So nothing is redeemed here until somebody types a password and presses the button. Loading the
 * page is inert: it parses the URL, decides whether the link is even the right shape, and shows a
 * form. A detonating scanner gets a form and stops, because it has no password to submit. The token
 * is spent by the one action a machine will not take on the recipient's behalf.
 *
 * ⚠ The consequence to keep in mind when editing: a link's validity is now UNKNOWN until submit, so
 * every failure that used to surface on load surfaces after typing instead. That is the trade — a
 * worse error moment for the rare broken link, in exchange for the common case working at all.
 */
const session = useSessionStore();
const router = useRouter();

type Step = "checking" | "password" | "unusable";
const step = ref<Step>("checking");
const linkError = ref<string | null>(null);

/** The parsed link, held from mount to submit — this is what makes redemption a deliberate act. */
const link = ref<InviteLinkParams | null>(null);

const password = ref("");
const confirm = ref("");
const error = ref<string | null>(null);
const loading = ref(false);

const RESEND_HINT = "Ask your administrator to resend the invitation.";
const SPENT =
  "This invitation link has already been used or has expired. " + RESEND_HINT;

/**
 * Decide whether this link is worth showing a form for — WITHOUT spending it.
 *
 * The only rejections here are ones that need no network call: an error fragment GoTrue redirected
 * with, or a URL carrying nothing redeemable and no existing session. Everything else is optimistic
 * on purpose; asking Supabase "is this token good?" is the same call as spending it.
 */
function prepare() {
  const params = parseInviteUrl(window.location.href);
  link.value = params;

  // Already signed in with a bare URL: supabase-js may have consumed a fragment during
  // `session.init()`, or the person reloaded after redeeming. Either way there is nothing to spend.
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
  step.value = "password";
}

onMounted(prepare);

/** Spend the token. Called once, from the submit handler, and never on load. */
async function redeem(params: InviteLinkParams): Promise<void> {
  if (params.accessToken && params.refreshToken) {
    const { error: e } = await supabase.auth.setSession({
      access_token: params.accessToken,
      refresh_token: params.refreshToken,
    });
    if (e) throw e;
    return;
  }
  if (params.code) {
    const { error: e } = await supabase.auth.exchangeCodeForSession(params.code);
    if (e) throw e;
    return;
  }
  if (params.verifyTokenHash) {
    const { error: e } = await supabase.auth.verifyOtp({
      type: (params.verifyType ?? "invite") as EmailOtpType,
      token_hash: params.verifyTokenHash,
    });
    if (e) throw e;
  }
}

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
    const params = link.value;
    // Redeem FIRST: without a session there is nothing to set a password on. A bare URL with an
    // existing session skips this — there is no token left to spend.
    if (params && hasSessionMaterial(params)) {
      try {
        await redeem(params);
      } catch {
        // The one failure that is worth its own screen: the link really is spent, and no amount of
        // retyping fixes it. Everything else below is a retryable error on this form.
        linkError.value = SPENT;
        step.value = "unusable";
        return;
      }
      // ADOPT the session the client now holds — do not rotate it. `refresh()` is
      // `refreshSession()`, which rotates a refresh token issued moments earlier; when that raced it
      // failed silently, the store stayed null, and this page told somebody their link had expired
      // while the server had already recorded their sign-in.
      await session.syncFromClient();
      // The credential is spent and must not sit in the address bar to be bookmarked or shared.
      window.history.replaceState(window.history.state, "", window.location.pathname);
    }

    if (!session.session) {
      error.value = "We couldn't sign you in from this link. " + RESEND_HINT;
      return;
    }

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
    <template v-if="step === 'checking'">
      <h2 class="mb-1 text-lg font-semibold text-ink">Checking your invitation…</h2>
      <p class="text-sm text-ink-muted">One moment.</p>
    </template>

    <template v-else-if="step === 'unusable'">
      <h2 class="mb-1 text-lg font-semibold text-ink">This link can't be used</h2>
      <p class="text-sm text-ink-muted">{{ linkError }}</p>
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
