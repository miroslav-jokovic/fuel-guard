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
    <header class="sticky top-0 z-40 border-b border-ink-inverse/10 bg-surface-inverse text-ink-inverse">
      <div class="flex h-12 items-center justify-between px-4 sm:px-6">
        <div class="flex items-center gap-3">
          <span class="rounded-control bg-brand-accent px-2 py-0.5 text-xs font-bold tracking-wide text-ink">PLATFORM</span>
          <span class="text-sm font-semibold">Silvicom 360 Control Plane</span>
        </div>
        <div class="flex items-center gap-3 text-sm">
          <span class="text-ink-inverse/70">{{ session.email }}</span>
          <AppButton size="sm" variant="soft" @click="signOut">Sign out</AppButton>
        </div>
      </div>
    </header>

    <!-- Impersonation banner — always visible while a read-only support session is active. -->
    <div v-if="imp.grants.length" class="bg-warning-100 text-warning-800">
      <div class="flex items-center justify-between px-4 py-2 text-sm sm:px-6">
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

    <div class="flex min-h-[calc(100vh-3rem)] flex-col md:flex-row">
      <nav class="flex shrink-0 gap-1 overflow-x-auto border-b border-edge-subtle bg-canvas p-3 md:w-60 md:flex-col md:border-r md:border-b-0 md:p-4">
        <template v-for="item in NAV" :key="item.label">
          <RouterLink
            v-if="item.to"
            :to="item.to"
            class="block min-h-9 whitespace-nowrap rounded-control px-3 py-2 text-sm font-medium text-ink-secondary hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            active-class="bg-selected-surface text-ink shadow-[inset_3px_0_var(--brand-accent-strong)]"
          >
            {{ item.label }}
          </RouterLink>
          <div v-else class="whitespace-nowrap rounded-control px-3 py-2 text-sm font-medium text-ink-disabled">
            {{ item.label }}
            <span class="ml-1 text-xs text-ink-tertiary">· soon</span>
          </div>
        </template>
      </nav>
      <main class="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
        <slot />
      </main>
    </div>
  </div>
</template>
