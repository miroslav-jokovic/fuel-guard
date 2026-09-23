<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { PASSWORD_MIN_LENGTH, passwordProblem, type PasswordResetPreview } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { useSessionStore } from "@/stores/session";
import { AppFormField as FormField } from "@silvicom/ui";
import { AppPasswordInput } from "@silvicom/ui";
import { AppButton as BaseButton } from "@silvicom/ui";

/**
 * Where an emailed reset link lands (0363, PASSWORD-RESET-PLAN.md) — `AcceptInvitePage`'s shape, on
 * purpose, because it answers the same three production failures (`lib/linkToken.ts` in the API):
 *
 *   on load   → `POST /api/public/password-reset/lookup`. A READ. It names the address and refuses a
 *               dead link before anybody types. A mail scanner that renders this page spends nothing.
 *   on submit → `POST /api/public/password-reset/redeem` with the new password — the ONE call that
 *               spends the link. The API has then ended every session the person had (D-PWR6), so
 *               this page signs in fresh with the password just chosen.
 *
 * The token comes off the route query and is removed from the address bar once spent, so a used
 * link is not left to be bookmarked or shared.
 */
const route = useRoute();
const router = useRouter();
const session = useSessionStore();

type Step = "checking" | "password" | "unusable";
const step = ref<Step>("checking");
const token = ref<string | null>(null);
const preview = ref<PasswordResetPreview | null>(null);

const password = ref("");
const confirm = ref("");
const error = ref<string | null>(null);
const loading = ref(false);

const DEAD_LINK = "This reset link is no longer valid — it may have been used, replaced by a newer one, or expired.";

async function prepare() {
  const raw = route.query.token;
  const t = typeof raw === "string" && raw.length >= 20 ? raw : null;
  if (!t) {
    step.value = "unusable";
    return;
  }
  token.value = t;
  const res = await apiFetch<PasswordResetPreview>("/api/public/password-reset/lookup", {
    method: "POST",
    body: { token: t },
  });
  if (!res.ok || !res.data) {
    step.value = "unusable";
    return;
  }
  preview.value = res.data;
  step.value = "password";
}

onMounted(prepare);

const canSubmit = computed(() => !loading.value && password.value.length > 0 && confirm.value.length > 0);

async function onSubmit() {
  error.value = null;
  if (!token.value || !preview.value) return;
  const problem = passwordProblem(password.value, preview.value.email, confirm.value);
  if (problem) {
    error.value = problem;
    return;
  }
  loading.value = true;
  try {
    const res = await apiFetch<{ ok: true; email: string }>("/api/public/password-reset/redeem", {
      method: "POST",
      body: { token: token.value, password: password.value },
    });
    if (!res.ok) {
      if (res.status === 404) {
        step.value = "unusable";
        return;
      }
      error.value = res.error?.message ?? "Could not change your password.";
      return;
    }
    window.history.replaceState(window.history.state, "", window.location.pathname);
    try {
      await session.signIn(preview.value.email, password.value);
      await session.syncFromClient();
    } catch {
      /* the password IS changed — fall through to the sign-in page with that said */
    }
    if (!session.session) {
      await router.push({ name: "login" });
      return;
    }
    await router.push(session.hasOrg ? "/" : "/pending");
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div>
    <template v-if="step === 'checking'">
      <h2 class="mb-1 text-lg font-semibold text-ink">Checking your link…</h2>
      <p class="text-sm text-ink-muted">One moment.</p>
    </template>

    <template v-else-if="step === 'unusable'">
      <h2 class="mb-1 text-lg font-semibold text-ink">This link can't be used</h2>
      <p class="text-sm text-ink-muted">{{ DEAD_LINK }} Ask for a new one.</p>
      <RouterLink to="/forgot-password" class="mt-6 inline-block text-sm text-brand-700 underline">Send a new reset link</RouterLink>
    </template>

    <template v-else>
      <h2 class="mb-1 text-lg font-semibold text-ink">Choose a new password</h2>
      <p class="mb-6 text-sm text-ink-muted">
        For <span class="font-medium text-ink">{{ preview?.email }}</span>. Every device signed in to this account will be
        signed out.
      </p>

      <form class="space-y-5" @submit.prevent="onSubmit">
        <FormField id="pw" v-slot="{ id }" label="New password" :hint="`At least ${PASSWORD_MIN_LENGTH} characters. A few words together work well.`">
          <AppPasswordInput :id="id" v-model="password" autocomplete="new-password" required />
        </FormField>
        <FormField id="cf" v-slot="{ id }" label="Confirm password">
          <AppPasswordInput :id="id" v-model="confirm" autocomplete="new-password" required />
        </FormField>

        <p v-if="error" class="text-sm text-danger-600">{{ error }}</p>

        <BaseButton type="submit" variant="primary" block :disabled="!canSubmit">
          {{ loading ? "Saving…" : "Set password & sign in" }}
        </BaseButton>
      </form>
    </template>
  </div>
</template>
