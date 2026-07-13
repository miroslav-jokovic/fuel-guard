<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useSessionStore } from "@/stores/session";
import FormField from "@/components/ui/FormField.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import BaseButton from "@/components/ui/BaseButton.vue";

const session = useSessionStore();
const router = useRouter();

const email = ref("");
const password = ref("");
const error = ref<string | null>(null);
const loading = ref(false);

async function onSubmit() {
  error.value = null;
  loading.value = true;
  try {
    await session.signIn(email.value, password.value);
    await session.refresh();
    router.push(session.hasOrg ? "/" : "/pending");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Sign in failed";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div>
    <h2 class="mb-6 text-lg font-semibold text-ink">Sign in to your account</h2>

    <form class="space-y-5" @submit.prevent="onSubmit">
      <FormField id="email" label="Email" v-slot="{ id }">
        <BaseInput :id="id" v-model="email" type="email" autocomplete="email" required />
      </FormField>

      <FormField id="password" label="Password" v-slot="{ id }">
        <BaseInput :id="id" v-model="password" type="password" autocomplete="current-password" required />
      </FormField>

      <p v-if="error" class="text-sm text-danger-600">{{ error }}</p>

      <BaseButton type="submit" variant="primary" block :disabled="loading">
        {{ loading ? "Signing in…" : "Sign in" }}
      </BaseButton>
    </form>

    <p class="mt-6 text-center text-sm text-ink-muted">
      Access is invite-only. Ask your administrator for an invitation.
    </p>
  </div>
</template>
