<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { AppButton, AppInput, AppCard } from "@fuelguard/ui";
import { useSessionStore } from "@/stores/session";

const session = useSessionStore();
const router = useRouter();

const email = ref("");
const password = ref("");
const error = ref<string | null>(null);
const busy = ref(false);

async function submit() {
  error.value = null;
  busy.value = true;
  try {
    await session.signIn(email.value.trim(), password.value);
    await session.refresh();
    // The guard routes to /mfa if MFA isn't satisfied yet, else to the dashboard.
    await router.push({ name: "dashboard" });
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Sign-in failed";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-full items-center justify-center px-4 py-16">
    <AppCard class="w-full max-w-sm">
      <div class="mb-6 text-center">
        <span class="rounded bg-brand-600 px-2 py-0.5 text-xs font-bold tracking-wide text-ink-inverse">PLATFORM</span>
        <h1 class="mt-3 text-lg font-semibold text-ink">FuelGuard Control Plane</h1>
        <p class="mt-1 text-sm text-ink-muted">Authorized operators only.</p>
      </div>
      <form class="space-y-4" @submit.prevent="submit">
        <div>
          <label class="mb-1 block text-sm font-medium text-ink-secondary">Email</label>
          <AppInput v-model="email" type="email" autocomplete="username" required />
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium text-ink-secondary">Password</label>
          <AppInput v-model="password" type="password" autocomplete="current-password" required />
        </div>
        <p v-if="error" class="text-sm text-danger-600">{{ error }}</p>
        <AppButton type="submit" variant="primary" block :disabled="busy">
          {{ busy ? "Signing in…" : "Continue" }}
        </AppButton>
      </form>
    </AppCard>
  </div>
</template>
