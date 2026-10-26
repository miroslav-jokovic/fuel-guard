<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter, type RouteLocationRaw } from "vue-router";
import { AppButton } from "@silvicom/ui";
import { useSessionStore } from "@/stores/session";
import { useImpersonationStore } from "@/stores/impersonation";

const session = useSessionStore();
const imp = useImpersonationStore();
const router = useRouter();
/**
 * Where "Silvicom 360" in the console's nav sends an operator — the customer-facing app.
 *
 * The default is the branded domain, `360.silvicominc.com`. Until 2026-10-23 it was the Railway host
 * (`fleetguardweb-production.up.railway.app`), deliberately: measured 2026-09-15 the branded name had
 * no DNS record at all, and shipping it would have put a dead link in every operator's sidebar. The
 * name now resolves and serves the same app (`/api/version` answered 200 with the released commit,
 * 2026-10-23), and the Railway host goes away with the AWS move (AWS-MIGRATION-PLAN.md), so the
 * branded name is the only one that survives it.
 *
 * ⚠ `import.meta.env.VITE_*` is inlined at BUILD time, so this value is baked into the bundle and
 * changing it needs a redeploy either way. The AWS images pass it as a build argument from the same
 * repository variable deploy-verify checks as "the web host" (`WEB_URL` / `STAGING_WEB_URL`), so a
 * staging console links to staging; this default is what Railway's console build, which passes
 * nothing, gets. `||`, not `??`: a repository variable that is unset reaches the build as an EMPTY
 * build argument, and `??` would ship an empty link.
 *
 * The default also matches `WEB_APP_URL` on the api service, which is what every application
 * invitation link already points at — so an operator following this lands on the same host an
 * applicant does, rather than on a second name for the same app.
 */
const customerAppUrl =
  import.meta.env.VITE_CUSTOMER_APP_URL || "https://360.silvicominc.com";

onMounted(() => {
  void imp.load().catch(() => {});
});

interface NavItem {
  label: string;
  to?: RouteLocationRaw;
  href?: string;
}
const NAV: NavItem[] = [
  { label: "Silvicom 360", href: customerAppUrl },
  { label: "Customers", to: { name: "customers" } },
  { label: "Users & access" },
  { label: "Billing" },
  { label: "Backups" },
  { label: "Settings", to: { name: "settings" } },
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
    <header class="sticky top-0 z-chrome border-b border-ink-inverse/10 bg-surface-inverse text-ink-inverse">
      <div class="flex h-12 items-center justify-between px-4 sm:px-6">
        <div class="flex items-center gap-3">
          <span class="rounded-control bg-brand-accent px-2 py-0.5 text-xs font-bold tracking-wide text-ink">PLATFORM</span>
          <!-- The plane's name and the operator's email give way on a phone; the PLATFORM mark and
               Sign out are what a narrow screen keeps (seen at 390 px, US7: the row ran 3 px wide). -->
          <span class="hidden text-sm font-semibold sm:inline">Silvicom 360 Control Plane</span>
        </div>
        <div class="flex items-center gap-3 text-sm">
          <span class="hidden text-ink-inverse/70 sm:inline">{{ session.email }}</span>
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
          <a
            v-if="item.href"
            :href="item.href"
            target="_blank"
            rel="noopener noreferrer"
            class="block min-h-9 whitespace-nowrap rounded-control px-3 py-2 text-sm font-medium text-ink-secondary hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            {{ item.label }}
          </a>
          <RouterLink
            v-else-if="item.to"
            :to="item.to"
            class="block min-h-9 whitespace-nowrap rounded-control px-3 py-2 text-sm font-medium text-ink-secondary hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            active-class="bg-selected-surface font-semibold text-ink"
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
