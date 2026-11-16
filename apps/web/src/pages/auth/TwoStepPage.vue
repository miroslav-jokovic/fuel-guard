<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { AppButton as BaseButton, AppCallout, AppInput, QueryState } from "@silvicom/ui";
import { supabase } from "@/lib/supabase";
import { useSessionStore } from "@/stores/session";

/**
 * Two-step sign-in (INSTALLED-APP-PLAN IA-S1): set an authenticator app up, enter its code, or see that it
 * is on. One page for the three, because which one a person needs is the server's answer, not theirs:
 *
 *   challenge  they have an authenticator and this session has not given its code — the router sends them
 *              here and nowhere else until it has (`session.secondFactor`, the API's 403);
 *   enroll     they have none: an admin whose date has passed (sent here), an admin in their 14 days of
 *              notice, or anybody who chose "Two-step sign-in" in the account menu;
 *   on         set up and satisfied — with Turn off, unless the role must keep it.
 *
 * Supabase's own TOTP, as the platform console uses it (`apps/admin/src/pages/MfaPage.vue`): the browser
 * talks to the auth server; our API never sees a secret or a code.
 *
 * ⚠ A LOST PHONE is not solved on this page and it says so: another admin of the company, or Silvicom, removes
 * the old authenticator (Q-IA11) and the person sets a new one up at their next sign-in.
 */
const session = useSessionStore();
const router = useRouter();

type Mode = "loading" | "enroll" | "challenge" | "on";
const mode = ref<Mode>("loading");
const factorId = ref<string | null>(null);
const qr = ref<string | null>(null);
const secret = ref<string | null>(null);
const code = ref("");
const error = ref<string | null>(null);
/** Preparing failed: its own state with a Retry, never a code box with nothing behind it. */
const setupError = ref<unknown>(null);
const busy = ref(false);

const status = computed(() => session.secondFactor);
/** Sent here by the guard: there is nowhere else to go until it is done, so no "Not now". */
const forced = computed(() => status.value?.required === true && status.value.satisfied === false);

async function prepare() {
  setupError.value = null;
  mode.value = "loading";
  code.value = "";
  try {
    const { data, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) throw listError;
    const verified = (data?.totp ?? []).filter((f) => f.status === "verified");
    if (verified.length > 0) {
      factorId.value = verified[0]!.id;
      const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      mode.value = level?.currentLevel === "aal2" ? "on" : "challenge";
      return;
    }
    // An enrolment started and never finished (the page was closed at the QR code) would refuse a new one
    // under the same name: remove it first. Only ever an UNVERIFIED factor — it protects nothing yet.
    for (const f of data?.all ?? []) if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Authenticator app" });
    if (enrollError) throw enrollError;
    factorId.value = enrolled.id;
    qr.value = enrolled.totp.qr_code;
    secret.value = enrolled.totp.secret;
    mode.value = "enroll";
  } catch (e) {
    setupError.value = e;
  }
}
onMounted(prepare);

/** The client holds the new token; the store adopts it and asks the API what it now says. */
async function adopt() {
  await session.syncFromClient();
  await session.loadSurfaces();
}

async function verify() {
  if (!factorId.value) return;
  error.value = null;
  busy.value = true;
  try {
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factorId.value, code: code.value.trim() });
    if (verifyError) throw verifyError;
    await adopt();
    await router.push({ name: "dashboard" });
  } catch {
    error.value = "That code was not accepted. Enter the current 6-digit code from your authenticator app.";
  } finally {
    busy.value = false;
  }
}

async function turnOff() {
  if (!factorId.value) return;
  error.value = null;
  busy.value = true;
  try {
    const { error: offError } = await supabase.auth.mfa.unenroll({ factorId: factorId.value });
    if (offError) throw offError;
    // A new token, so the session stops saying a second step was taken with a factor that no longer exists.
    await session.refresh();
    await session.loadSurfaces();
    await router.push({ name: "dashboard" });
  } catch {
    error.value = "Could not turn two-step sign-in off. Try again.";
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
    <h2 class="text-lg font-semibold text-ink">Two-step sign-in</h2>
    <p class="mt-1 text-sm text-ink-muted" data-testid="two-step-lead">
      <template v-if="mode === 'enroll'">Scan this with an authenticator app on your phone, then enter the 6-digit code it shows.</template>
      <template v-else-if="mode === 'challenge'">Enter the 6-digit code from your authenticator app.</template>
      <template v-else-if="mode === 'on'">Two-step sign-in is on. Each time you sign in you enter a code from your authenticator app.</template>
    </p>

    <QueryState
      class="mt-5"
      compact
      :loading="mode === 'loading' && !setupError"
      :error="setupError"
      error-text="Could not prepare two-step sign-in."
      loading-text="Preparing two-step sign-in…"
      @retry="prepare"
    >
      <div v-if="mode === 'enroll' && qr" class="mt-4 flex flex-col items-center gap-2">
        <img :src="qr" alt="QR code for your authenticator app" class="two-step-qr size-44 rounded-control p-2" />
        <p class="text-xs text-ink-muted">Cannot scan it? Type this key into the app instead:</p>
        <code v-if="secret" class="break-all rounded-control bg-surface-muted px-2 py-1 text-xs text-ink-secondary" data-testid="two-step-secret">{{ secret }}</code>
      </div>

      <form v-if="mode === 'enroll' || mode === 'challenge'" class="mt-5 space-y-4" @submit.prevent="verify">
        <AppInput v-model="code" aria-label="6-digit code" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" maxlength="6" required />
        <AppCallout v-if="error" tone="danger" role="alert">{{ error }}</AppCallout>
        <BaseButton type="submit" variant="primary" block :disabled="busy">{{ busy ? "Checking…" : mode === "enroll" ? "Turn on two-step sign-in" : "Continue" }}</BaseButton>
      </form>

      <div v-if="mode === 'on'" class="mt-5 space-y-3">
        <AppCallout v-if="error" tone="danger" role="alert">{{ error }}</AppCallout>
        <p v-if="status?.must_keep" class="text-sm text-ink-muted" data-testid="two-step-must-keep">Admins are required to use it, so it cannot be turned off.</p>
        <BaseButton v-else variant="secondary" block :disabled="busy" @click="turnOff">Turn off two-step sign-in</BaseButton>
      </div>

      <p v-if="mode === 'challenge'" class="mt-4 text-xs text-ink-muted">
        Lost the phone with your authenticator app? An admin of your company can remove it from Settings, Users, and you
        set a new one up the next time you sign in.
      </p>
    </QueryState>

    <div class="mt-6 flex items-center justify-between text-sm">
      <BaseButton v-if="!forced" variant="link" @click="router.push({ name: 'dashboard' })">{{ mode === "on" ? "Back" : "Not now" }}</BaseButton>
      <span v-else />
      <BaseButton variant="link" @click="signOut">Sign out</BaseButton>
    </div>
  </div>
</template>

<style scoped>
/*
 * The QR code's ground is WHITE in both schemes, and deliberately not a token: every surface token darkens in
 * the dark scheme, and a QR code on a dark ground is one a phone camera cannot read. It is the one thing on
 * the page that is a printed object rather than part of the interface.
 */
.two-step-qr {
  background-color: white;
}
</style>
