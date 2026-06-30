<script setup lang="ts">
import { useRouter } from "vue-router";
import { useSessionStore } from "@/stores/session";

// Shown when a user is authenticated but has no membership yet (audit B3) — never a blank screen.
const session = useSessionStore();
const router = useRouter();

async function signOut() {
  await session.signOut();
  router.push("/login");
}
</script>

<template>
  <div class="text-center">
    <h2 class="text-lg font-semibold text-gray-900">Account pending</h2>
    <p class="mt-2 text-sm text-gray-500">
      You're signed in as <span class="font-medium">{{ session.email }}</span
      >, but your account isn't linked to an organization yet. An administrator needs to invite or
      approve you.
    </p>
    <button
      class="mt-6 rounded-md bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200"
      @click="signOut"
    >
      Sign out
    </button>
  </div>
</template>
