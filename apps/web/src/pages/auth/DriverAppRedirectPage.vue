<script setup lang="ts">
import { useRouter } from "vue-router";
import { useSessionStore } from "@/stores/session";
import { AppButton as BaseButton } from "@silvicom/ui";

// Drivers use the FuelGuard Driver app, not this office dashboard (Driver App, Phase 1 web gate).
const session = useSessionStore();
const router = useRouter();

async function signOut() {
  await session.signOut();
  router.push("/login");
}
</script>

<template>
  <div class="text-center">
    <h2 class="text-lg font-semibold text-ink">Use the Silvicom 360 Driver app</h2>
    <p class="mt-2 text-sm text-ink-muted">
      You're signed in as <span class="font-medium">{{ session.email }}</span
      >. This dashboard is for office staff — drivers log fuel and see their trucks in the
      <span class="font-medium">Silvicom 360 Driver</span> app on your phone.
    </p>
    <BaseButton variant="soft" class="mt-6" @click="signOut">Sign out</BaseButton>
  </div>
</template>
