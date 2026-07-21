<script setup lang="ts">
import { useRouter } from "vue-router";
import { AppButton } from "@fuelguard/ui";
import { useSessionStore } from "@/stores/session";

const session = useSessionStore();
const router = useRouter();

const NAV = [
  "Customers",
  "Users & access",
  "Billing",
  "Backups",
  "Settings & flags",
  "Errors & repairs",
  "Audit",
];

async function signOut() {
  await session.signOut();
  await router.push({ name: "login" });
}
</script>

<template>
  <div class="min-h-full">
    <!-- Persistent PLATFORM chrome so an operator always knows which plane they're in. -->
    <header class="bg-surface-inverse text-ink-inverse">
      <div class="mx-auto flex max-w-7xl items-center justify-between px-4 py-2.5">
        <div class="flex items-center gap-3">
          <span class="rounded bg-brand-600 px-2 py-0.5 text-xs font-bold tracking-wide">PLATFORM</span>
          <span class="text-sm font-semibold">FuelGuard Control Plane</span>
        </div>
        <div class="flex items-center gap-3 text-sm">
          <span class="text-ink-inverse/70">{{ session.email }}</span>
          <AppButton size="sm" variant="soft" @click="signOut">Sign out</AppButton>
        </div>
      </div>
    </header>

    <div class="mx-auto flex max-w-7xl gap-6 px-4 py-6">
      <nav class="w-56 shrink-0 space-y-1">
        <div
          v-for="item in NAV"
          :key="item"
          class="rounded-md px-3 py-2 text-sm font-medium text-ink-muted"
        >
          {{ item }}
          <span class="ml-1 text-xs text-ink-subtle">· soon</span>
        </div>
      </nav>
      <main class="min-w-0 flex-1">
        <slot />
      </main>
    </div>
  </div>
</template>
