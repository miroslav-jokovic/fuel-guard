<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { parseInviteUrl, USER_ROLE_LABELS, type InvitePreview } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { useSessionStore } from "@/stores/session";
import { AppFormField as FormField } from "@silvicom/ui";
import { AppInput as BaseInput } from "@silvicom/ui";
import { AppButton as BaseButton } from "@silvicom/ui";

/**
 * Where an invited person sets their password and becomes a member.
 *
 * ── THE LINK IS OURS, AND NOTHING HAPPENS UNTIL A PASSWORD IS TYPED (2026-09-04) ────────────────
 * The emailed link carries the invitation's own token (`?token=…`, `lib/linkToken.ts` in the API),
 * not a Supabase one-time token. Three things about the old token each lost a real invitation and
 * are written up in `docs/EMAIL-LINK-DELIVERY.md`: a mail scanner spent it within a minute of
 * delivery; it expired after ONE HOUR while the email promised seven days (measured 2026-09-03 —
 * the token sat unspent overnight and the click got "expired"); and a resend silently killed the
 * link already in the inbox.
 *
 * So this page does two things with the token and never a third:
 *
 *   on load   → `POST /api/public/invites/lookup`. A READ. It says who the invitation is for and
 *               which organisation it joins, so the form already knows the answers, and it says a
 *               dead link is dead BEFORE anybody types. A scanner that renders this page gets
 *               exactly that and stops.
 *   on submit → `POST /api/public/invites/redeem` with the password. The ONE call that spends the
 *               token: it creates the login and the membership. Then this page signs in with the
 *               password it just set, and the session it gets already carries the org and role.
 *
 * The router sends nobody through GoTrue's `verifyOtp` any more, and there is no session to adopt
 * or rotate before the sign-in — the two places the previous versions of this page went wrong.
 */
const session = useSessionStore();
const router = useRouter();

type Step = "checking" | "password" | "unusable";
const step = ref<Step>("checking");
const linkError = ref<string | null>(null);

const token = ref<string | null>(null);
const invite = ref<InvitePreview | null>(null);

const fullName = ref("");
const password = ref("");
const confirm = ref("");
const error = ref<string | null>(null);
const loading = ref(false);

const RESEND_HINT = "Ask your administrator to send a new invitation.";
const DEAD_LINK = "This invitation link is no longer valid. " + RESEND_HINT;
const OLD_LINK =
  "This link is from an earlier kind of invitation and no longer works. " + RESEND_HINT;
const NOT_A_LINK = "This doesn’t look like an invitation link.";

const roleLabel = computed(() => (invite.value ? USER_ROLE_LABELS[invite.value.role] : ""));

/** Read the link. Spends nothing; a dead link is refused here, before the person has typed. */
async function prepare() {
  const params = parseInviteUrl(window.location.href);
  if (!params.inviteToken) {
    // A GoTrue-shaped link — `token_hash`, a fragment, an error fragment — is one emailed before
    // 2026-09-04. Its token is either spent or an hour past dead; only a resend helps.
    const legacy = params.verifyTokenHash || params.accessToken || params.code || params.errorDescription;
    linkError.value = legacy ? OLD_LINK : NOT_A_LINK;
    step.value = "unusable";
    return;
  }
  token.value = params.inviteToken;
  const res = await apiFetch<InvitePreview>("/api/public/invites/lookup", {
    method: "POST",
    body: { token: params.inviteToken },
  });
  if (!res.ok || !res.data) {
    linkError.value = res.status === 404 ? DEAD_LINK : (res.error?.message ?? DEAD_LINK);
    step.value = "unusable";
    return;
  }
  invite.value = res.data;
  if (res.data.fullName && fullName.value.trim().length === 0) fullName.value = res.data.fullName;
  step.value = "password";
}

onMounted(prepare);

const canSubmit = computed(
  () => !loading.value && password.value.length > 0 && fullName.value.trim().length > 0,
);

async function onSubmit() {
  error.value = null;
  if (fullName.value.trim().length === 0) {
    error.value = "Tell us your name.";
    return;
  }
  if (password.value.length < 8) {
    error.value = "Password must be at least 8 characters.";
    return;
  }
  if (password.value !== confirm.value) {
    error.value = "Passwords do not match.";
    return;
  }
  if (!token.value || !invite.value) return;
  loading.value = true;
  try {
    const res = await apiFetch<{ ok: true; email: string }>("/api/public/invites/redeem", {
      method: "POST",
      body: { token: token.value, password: password.value, fullName: fullName.value.trim() },
    });
    if (!res.ok) {
      if (res.status === 404) {
        // The one failure that is worth its own screen: the link died between load and submit
        // (revoked, resent, or a second submit won). Retyping cannot fix it.
        linkError.value = DEAD_LINK;
        step.value = "unusable";
        return;
      }
      error.value = res.error?.message ?? "Could not accept the invitation.";
      return;
    }

    // The membership exists now, so the token minted by this sign-in already carries the org and
    // role claims — no refresh, no rotation, nothing to race.
    await session.signIn(invite.value.email, password.value);
    await session.syncFromClient();
    // The credential is spent and must not sit in the address bar to be bookmarked or shared.
    window.history.replaceState(window.history.state, "", window.location.pathname);
    if (!session.session) {
      error.value = "Your account is ready, but we couldn't sign you in here. Go to sign in and use your new password.";
      return;
    }
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
      <h2 class="mb-1 text-lg font-semibold text-ink">Join {{ invite?.orgName }}</h2>
      <p class="mb-6 text-sm text-ink-muted">
        You're invited as <span class="font-medium text-ink">{{ roleLabel }}</span>.
        Choose a password for <span class="font-medium text-ink">{{ invite?.email }}</span> to finish setting up your Silvicom 360 account.
      </p>

      <form class="space-y-5" @submit.prevent="onSubmit">
        <FormField id="nm" v-slot="{ id }" label="Your name" hint="How colleagues will see you across Silvicom 360.">
          <BaseInput :id="id" v-model="fullName" type="text" autocomplete="name" required maxlength="120" />
        </FormField>
        <FormField id="pw" v-slot="{ id }" label="New password" hint="At least 8 characters.">
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
