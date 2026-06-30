<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";
import { useSessionStore } from "@/stores/session";

// Reached via the Supabase invite email link, which establishes a session. The user sets a
// password, then we create their membership (API) and refresh the token to load org/role claims.
const session = useSessionStore();
const router = useRouter();

const password = ref("");
const confirm = ref("");
const error = ref<string | null>(null);
const loading = ref(false);

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
    <h2 class="mb-1 text-lg font-semibold text-gray-900">Set your password</h2>
    <p class="mb-6 text-sm text-gray-500">Finish setting up your FleetGuard account.</p>

    <form class="space-y-5" @submit.prevent="onSubmit">
      <div>
        <label for="pw" class="block text-sm font-medium text-gray-900">New password</label>
        <input
          id="pw"
          v-model="password"
          type="password"
          autocomplete="new-password"
          required
          class="mt-2 block w-full rounded-md border-0 px-3 py-1.5 text-gray-900 ring-1 ring-gray-300 ring-inset focus:ring-2 focus:ring-indigo-600 sm:text-sm"
        />
      </div>
      <div>
        <label for="cf" class="block text-sm font-medium text-gray-900">Confirm password</label>
        <input
          id="cf"
          v-model="confirm"
          type="password"
          autocomplete="new-password"
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
        {{ loading ? "Saving…" : "Set password & continue" }}
      </button>
    </form>
  </div>
</template>
