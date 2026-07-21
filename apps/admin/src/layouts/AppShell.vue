<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter, type RouteLocationRaw } from "vue-router";
import { AppButton } from "@fuelguard/ui";
import { useSessionStore } from "@/stores/session";
import { useImpersonationStore } from "@/stores/impersonation";

const session = useSessionStore();
const imp = useImpersonationStore();
const router = useRouter();

onMounted(() => {
  void imp.load().catch(() => {});
});

interface NavItem {
  label: string;
  to?: RouteLocationRaw;
}
const NAV: NavItem[] = [
  { label: "Customers", to: { name: "customers" } },
  { label: "Users & access" },
  { label: "Billing" },
  { label: "Backups" },
  { label: "Settings & flags" },
  { label: "Errors & repairs" },
  { label: "Audit" },
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

    <!-- Impersonation banner — always visible while a read-only support session is active. -->
    <div v-if="imp.grants.length" class="bg-warning-100 text-warning-800">
      <div class="mx-auto flex max-w-7xl items-center justify-between px-4 py-2 text-sm">
        <span>
          <span class="font-semibold">Read-only support session active</span>
          on {{ imp.grants.length }} customer<span v-if="imp.grants.length > 1">s</span>.
        </span>
        <RouterLink
          :to="{ name: 'customer-view', params: { id: imp.grants[0]!.orgId } }"
          class="font-semibold underline"
        >
          Open
        </RouterLink>
      </div>
    </div>

    <div class="mx-auto flex max-w-7xl gap-6 px-4 py-6">
      <nav class="w-56 shrink-0 space-y-1">
        <template v-for="item in NAV" :key="item.label">
          <RouterLink
            v-if="item.to"
            :to="item.to"
            class="block rounded-md px-3 py-2 text-sm font-medium text-ink-secondary hover:bg-surface-subtle"
            active-class="bg-surface-subtle text-ink"
          >
            {{ item.label }}
          </RouterLink>
          <div v-else class="rounded-md px-3 py-2 text-sm font-medium text-ink-muted">
            {{ item.label }}
            <span class="ml-1 text-xs text-ink-subtle">· soon</span>
          </div>
        </template>
      </nav>
      <main class="min-w-0 flex-1">
        <slot />
      </main>
    </div>
  </div>
</template>
