<script setup lang="ts">
import { useRouter } from "vue-router";
import { useSessionStore } from "@/stores/session";
import BaseButton from "@/components/ui/BaseButton.vue";

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
    <h2 class="text-lg font-semibold text-ink">Account pending</h2>
    <p class="mt-2 text-sm text-ink-muted">
      You're signed in as <span class="font-medium">{{ session.email }}</span
      >, but your account isn't linked to an organization yet. An administrator needs to invite or
      approve you.
    </p>
    <BaseButton variant="soft" class="mt-6" @click="signOut">Sign out</BaseButton>
  </div>
</template>
