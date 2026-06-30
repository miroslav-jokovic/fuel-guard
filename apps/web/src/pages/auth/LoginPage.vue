<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useSessionStore } from "@/stores/session";

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
    <h2 class="mb-6 text-lg font-semibold text-gray-900">Sign in to your account</h2>

    <form class="space-y-5" @submit.prevent="onSubmit">
      <div>
        <label for="email" class="block text-sm font-medium text-gray-900">Email</label>
        <input
          id="email"
          v-model="email"
          type="email"
          autocomplete="email"
          required
          class="mt-2 block w-full rounded-md border-0 px-3 py-1.5 text-gray-900 ring-1 ring-gray-300 ring-inset focus:ring-2 focus:ring-indigo-600 sm:text-sm"
        />
      </div>

      <div>
        <label for="password" class="block text-sm font-medium text-gray-900">Password</label>
        <input
          id="password"
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
          class="mt-2 block w-full rounded-md border-0 px-3 py-1.5 text-gray-900 ring-1 ring-gray-300 ring-inset focus:ring-2 focus:ring-indigo-600 sm:text-sm"
        />
      </div>

      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

      <button
        type="submit"
        :disabled="loading"
        class="flex w-full justify-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
      >
        {{ loading ? "Signing in…" : "Sign in" }}
      </button>
    </form>

    <p class="mt-6 text-center text-sm text-gray-500">
      Access is invite-only. Ask your administrator for an invitation.
    </p>
  </div>
</template>
